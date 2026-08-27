/**
 * VERALUZ — Edge Function : documents-secure
 * RECOVERY LOT D — Documents/SSOT
 *
 * Autorité serveur pour le module Documents.
 * Authentification : X-Veraluz-Session uniquement (jamais dans le body).
 * Accès : documents.read / documents.manage → rôle gerant uniquement pour ce socle.
 * Stockage : service_role côté serveur uniquement.
 * Pas de suppression définitive.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability } from '../_shared/_rbac.ts';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

const ACTIVE_STATUSES = new Set(['actif', 'active']);

// Mapping catégorie → bucket privé (source de vérité côté serveur uniquement)
const CAT_BUCKETS: Record<string, string> = {
  legal:      'veraluz-legal-private',
  bank:       'veraluz-bank-private',
  tax:        'veraluz-documents-private',
  hr:         'veraluz-hr-private',
  supplier:   'veraluz-documents-private',
  insurance:  'veraluz-documents-private',
  property:   'veraluz-legal-private',
  finance:    'veraluz-documents-private',
  operations: 'veraluz-documents-private',
  identity:   'veraluz-legal-private',
  other:      'veraluz-documents-private',
};

const VALID_CONFIDENTIALITY = new Set(['public', 'internal', 'confidential', 'restricted']);
const VALID_STATUS          = new Set(['active', 'expired', 'archived', 'missing', 'pending_review']);
const VALID_CATEGORIES      = new Set(Object.keys(CAT_BUCKETS));

// Champs acceptés en création (liste fermée)
const CREATE_ALLOWED = new Set([
  'title', 'category', 'document_type', 'confidentiality_level', 'status',
  'expiry_date', 'reminder_date', 'related_module', 'related_record_id', 'notes', 'tags',
]);
// Champs acceptés en modification (liste fermée — uploaded_by et storage_bucket exclus)
const UPDATE_ALLOWED = new Set([
  'title', 'document_type', 'confidentiality_level', 'status',
  'expiry_date', 'reminder_date', 'related_module', 'related_record_id',
  'reviewed_by', 'notes', 'tags',
]);

type DbClient = ReturnType<typeof createClient>;
type Actor = { id: string; role: string };

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function validateSession(
  db: DbClient,
  rawToken: string,
): Promise<{ actor: Actor | null; serverError: boolean }> {
  if (!rawToken || rawToken.length < 16) return { actor: null, serverError: false };

  const tokenHash = await sha256Hex(rawToken);
  const { data: session, error: sessionError } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (sessionError) {
    console.error('[documents-secure] session_lookup_failed', sessionError.code);
    return { actor: null, serverError: true };
  }
  if (!session) return { actor: null, serverError: false };

  const { data: emp, error: empError } = await db
    .from('veraluz_employees')
    .select('id, role, status')
    .eq('id', session.employee_id)
    .maybeSingle();

  if (empError) {
    console.error('[documents-secure] actor_lookup_failed', empError.code);
    return { actor: null, serverError: true };
  }
  if (!emp || !ACTIVE_STATUSES.has(String(emp.status || '').toLowerCase())) {
    return { actor: null, serverError: false };
  }

  return {
    actor: { id: String(emp.id), role: normalizeRole(emp.role) },
    serverError: false,
  };
}

function optText(v: unknown, max = 255): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim().slice(0, max) || null;
}

function optDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // Accepte YYYY-MM-DD uniquement
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ ok: false, error: 'forbidden_origin' }, 403, origin);
  }

  // 1. Parse body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, origin);
  }

  // 2. session_token dans le body = refus immédiat
  if ('session_token' in body) {
    return json({ ok: false, error: 'session_token_in_body_forbidden' }, 400, origin);
  }

  // 3. Valider X-Veraluz-Session
  const rawToken = req.headers.get('x-veraluz-session')?.trim() || '';
  if (!rawToken) {
    return json({ ok: false, error: 'session_required' }, 401, origin);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { actor, serverError } = await validateSession(db, rawToken);
  if (serverError) return json({ ok: false, error: 'server_error' }, 500, origin);
  if (!actor)      return json({ ok: false, error: 'invalid_or_expired_session' }, 401, origin);

  // 4. Vérification des capabilities
  const canRead   = hasCapability(actor.role, 'documents.read');
  const canManage = hasCapability(actor.role, 'documents.manage');

  if (!canRead) {
    return json({ ok: false, error: 'documents_access_forbidden', role: actor.role }, 403, origin);
  }

  // 5. Dispatch actions
  const action = String(body.action || '').trim();

  // ── LIST ────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const { data, error } = await db
      .from('veraluz_documents')
      .select('id,title,category,document_type,confidentiality_level,status,storage_bucket,storage_path,file_name,file_type,file_size,expiry_date,reminder_date,uploaded_by,reviewed_by,related_module,related_record_id,notes,tags,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('[documents-secure] list_failed', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, documents: data ?? [] }, 200, origin);
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (action === 'get') {
    const docId = optText(body.id, 36);
    if (!docId) return json({ ok: false, error: 'id_required' }, 400, origin);

    const { data, error } = await db
      .from('veraluz_documents')
      .select('*')
      .eq('id', docId)
      .maybeSingle();

    if (error) {
      console.error('[documents-secure] get_failed', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    if (!data) return json({ ok: false, error: 'document_not_found' }, 404, origin);
    return json({ ok: true, document: data }, 200, origin);
  }

  // ── CREATE ───────────────────────────────────────────────────────────────
  if (action === 'create') {
    if (!canManage) {
      return json({ ok: false, error: 'documents_manage_forbidden' }, 403, origin);
    }

    const title    = optText(body.title, 255);
    const category = optText(body.category, 64);
    if (!title)    return json({ ok: false, error: 'title_required' }, 400, origin);
    if (!category) return json({ ok: false, error: 'category_required' }, 400, origin);
    if (!VALID_CATEGORIES.has(category)) {
      return json({ ok: false, error: 'invalid_category' }, 400, origin);
    }

    const confLevel = optText(body.confidentiality_level, 32) ?? 'internal';
    const status    = optText(body.status, 32) ?? 'active';
    if (!VALID_CONFIDENTIALITY.has(confLevel)) {
      return json({ ok: false, error: 'invalid_confidentiality_level' }, 400, origin);
    }
    if (!VALID_STATUS.has(status)) {
      return json({ ok: false, error: 'invalid_status' }, 400, origin);
    }

    // Filtrer les champs soumis — rejeter tout champ hors liste blanche
    const extraKeys = Object.keys(body).filter(
      k => !CREATE_ALLOWED.has(k) && k !== 'action'
    );
    if (extraKeys.length > 0) {
      return json({ ok: false, error: 'unexpected_fields', fields: extraKeys }, 400, origin);
    }

    // Calculé côté serveur — jamais fourni par le client
    const uploadedBy   = actor.id;
    const storageBucket = CAT_BUCKETS[category] ?? 'veraluz-documents-private';

    const insert: Record<string, unknown> = {
      title,
      category,
      confidentiality_level: confLevel,
      status,
      storage_bucket: storageBucket,
      uploaded_by:    uploadedBy,
    };

    // Champs optionnels
    const dtype   = optText(body.document_type, 128);
    const expiry  = optDate(body.expiry_date);
    const reminder = optDate(body.reminder_date);
    const relMod  = optText(body.related_module, 64);
    const relRec  = optText(body.related_record_id, 36);
    const notes   = optText(body.notes, 2000);

    if (dtype)    insert.document_type      = dtype;
    if (expiry)   insert.expiry_date        = expiry;
    if (reminder) insert.reminder_date      = reminder;
    if (relMod)   insert.related_module     = relMod;
    if (relRec)   insert.related_record_id  = relRec;
    if (notes)    insert.notes              = notes;
    if (Array.isArray(body.tags)) {
      insert.tags = (body.tags as unknown[]).map(t => String(t).slice(0, 64)).slice(0, 20);
    }

    const { data, error } = await db
      .from('veraluz_documents')
      .insert(insert)
      .select('id,title,category,status,created_at')
      .single();

    if (error) {
      console.error('[documents-secure] create_failed', error.code, error.message);
      return json({ ok: false, error: 'create_failed', detail: error.message }, 500, origin);
    }
    return json({ ok: true, document: data }, 201, origin);
  }

  // ── UPDATE ───────────────────────────────────────────────────────────────
  if (action === 'update') {
    if (!canManage) {
      return json({ ok: false, error: 'documents_manage_forbidden' }, 403, origin);
    }

    const docId = optText(body.id, 36);
    if (!docId) return json({ ok: false, error: 'id_required' }, 400, origin);

    // Filtrer les champs soumis
    const extraKeys = Object.keys(body).filter(
      k => !UPDATE_ALLOWED.has(k) && k !== 'action' && k !== 'id'
    );
    if (extraKeys.length > 0) {
      return json({ ok: false, error: 'unexpected_fields', fields: extraKeys }, 400, origin);
    }

    const patch: Record<string, unknown> = {};

    if ('title' in body) {
      const t = optText(body.title, 255);
      if (!t) return json({ ok: false, error: 'title_required' }, 400, origin);
      patch.title = t;
    }
    if ('document_type' in body)      patch.document_type      = optText(body.document_type, 128);
    if ('confidentiality_level' in body) {
      const c = optText(body.confidentiality_level, 32);
      if (c && !VALID_CONFIDENTIALITY.has(c)) {
        return json({ ok: false, error: 'invalid_confidentiality_level' }, 400, origin);
      }
      patch.confidentiality_level = c;
    }
    if ('status' in body) {
      const s = optText(body.status, 32);
      if (s && !VALID_STATUS.has(s)) {
        return json({ ok: false, error: 'invalid_status' }, 400, origin);
      }
      patch.status = s;
    }
    if ('expiry_date' in body)        patch.expiry_date        = optDate(body.expiry_date);
    if ('reminder_date' in body)      patch.reminder_date      = optDate(body.reminder_date);
    if ('related_module' in body)     patch.related_module     = optText(body.related_module, 64);
    if ('related_record_id' in body)  patch.related_record_id  = optText(body.related_record_id, 36);
    if ('reviewed_by' in body)        patch.reviewed_by        = optText(body.reviewed_by, 255);
    if ('notes' in body)              patch.notes              = optText(body.notes, 2000);
    if ('tags' in body && Array.isArray(body.tags)) {
      patch.tags = (body.tags as unknown[]).map(t => String(t).slice(0, 64)).slice(0, 20);
    }

    if (!Object.keys(patch).length) {
      return json({ ok: false, error: 'no_fields_to_update' }, 400, origin);
    }

    const { data, error } = await db
      .from('veraluz_documents')
      .update(patch)
      .eq('id', docId)
      .select('id,title,status,updated_at')
      .maybeSingle();

    if (error) {
      console.error('[documents-secure] update_failed', error.code, error.message);
      return json({ ok: false, error: 'update_failed', detail: error.message }, 500, origin);
    }
    if (!data) return json({ ok: false, error: 'document_not_found' }, 404, origin);
    return json({ ok: true, document: data }, 200, origin);
  }

  // ── ARCHIVE ──────────────────────────────────────────────────────────────
  if (action === 'archive') {
    if (!canManage) {
      return json({ ok: false, error: 'documents_manage_forbidden' }, 403, origin);
    }

    const docId = optText(body.id, 36);
    if (!docId) return json({ ok: false, error: 'id_required' }, 400, origin);

    const { data, error } = await db
      .from('veraluz_documents')
      .update({ status: 'archived' })
      .eq('id', docId)
      .neq('status', 'archived') // idempotent
      .select('id,title,status,updated_at')
      .maybeSingle();

    if (error) {
      console.error('[documents-secure] archive_failed', error.code, error.message);
      return json({ ok: false, error: 'archive_failed', detail: error.message }, 500, origin);
    }
    return json({ ok: true, document: data }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action', action }, 400, origin);
});
