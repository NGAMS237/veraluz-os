/**
 * VERALUZ — Edge Function : documents-secure (v3)
 * RECOVERY LOT D — Documents/SSOT
 *
 * Authentification : X-Veraluz-Session uniquement (jamais dans le body).
 * Accès : documents.read / documents.manage → rôle gerant uniquement (socle Lot D).
 * service_role strictement côté serveur.
 * Pas de suppression définitive.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability } from '../_shared/_rbac.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

const ACTIVE_STATUSES = new Set(['actif', 'active']);

/** Supprimer les champs Storage sensibles avant envoi au navigateur */
function sanitizeDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const { storage_path, storage_bucket, ...rest } = doc as Record<string, unknown>;
  return { ...rest, has_file: !!(storage_path) };
}

// Mapping catégorie → bucket privé — calculé côté serveur uniquement
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

// Champs acceptés en création — uploaded_by, reviewed_by, storage_bucket exclus
const CREATE_ALLOWED = new Set([
  'title', 'category', 'document_type', 'confidentiality_level', 'status',
  'expiry_date', 'reminder_date', 'related_module', 'related_record_id', 'notes', 'tags',
]);
// Champs acceptés en modification — uploaded_by, reviewed_by, storage_bucket, category exclus
const UPDATE_ALLOWED = new Set([
  'title', 'document_type', 'confidentiality_level', 'status',
  'expiry_date', 'reminder_date', 'related_module', 'related_record_id', 'notes', 'tags',
]);

type DbClient = ReturnType<typeof createClient>;
type Actor = { id: string; role: string };

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
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
    console.error('[documents-secure] session_lookup_failed code=%s', sessionError.code);
    return { actor: null, serverError: true };
  }
  if (!session) return { actor: null, serverError: false };

  const { data: emp, error: empError } = await db
    .from('veraluz_employees')
    .select('id, role, status')
    .eq('id', session.employee_id)
    .maybeSingle();

  if (empError) {
    console.error('[documents-secure] actor_lookup_failed code=%s', empError.code);
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

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function optText(v: unknown, max = 255): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).trim().slice(0, max) || null;
}

/** UUID RFC-4122 validation */
function isValidUUID(v: unknown): boolean {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Parse a date field:
 * - null / undefined / absent → { ok: true, value: null }  (clear the date)
 * - '' (empty string)        → { ok: true, value: null }  (clear the date)
 * - valid YYYY-MM-DD         → { ok: true, value: 'YYYY-MM-DD' }
 * - any other string         → { ok: false }              → 400 invalid_date
 */
type DateResult = { ok: true; value: string | null } | { ok: false };

function parseDate(v: unknown): DateResult {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const s = v.trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: s };
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

  // 2. session_token dans le body → refus immédiat
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

  // 4. Capabilities
  const canRead   = hasCapability(actor.role, 'documents.read');
  const canManage = hasCapability(actor.role, 'documents.manage');

  if (!canRead) {
    return json({ ok: false, error: 'documents_access_forbidden' }, 403, origin);
  }

  // 5. Dispatch
  const action = String(body.action || '').trim();

  // ── LIST ─────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const { data, error } = await db
      .from('veraluz_documents')
      .select('id,title,category,document_type,confidentiality_level,status,storage_bucket,storage_path,file_name,file_type,file_size,expiry_date,reminder_date,uploaded_by,related_module,related_record_id,notes,tags,created_at,updated_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('[documents-secure] list_failed code=%s msg=%s', error.code, error.message);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, documents: (data ?? []).map(sanitizeDoc) }, 200, origin);
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (action === 'get') {
    if (!isValidUUID(body.id)) {
      return json({ ok: false, error: 'invalid_id' }, 400, origin);
    }
    const docId = String(body.id);

    const { data, error } = await db
      .from('veraluz_documents')
      .select('id,title,category,document_type,confidentiality_level,status,storage_bucket,storage_path,file_name,file_type,file_size,expiry_date,reminder_date,uploaded_by,related_module,related_record_id,notes,tags,created_at,updated_at')
      .eq('id', docId)
      .maybeSingle();

    if (error) {
      console.error('[documents-secure] get_failed code=%s msg=%s', error.code, error.message);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    if (!data) return json({ ok: false, error: 'document_not_found' }, 404, origin);
    return json({ ok: true, document: sanitizeDoc(data as Record<string, unknown>) }, 200, origin);
  }

  // ── CREATE ────────────────────────────────────────────────────────────────
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

    // Rejeter champs hors liste blanche (uploaded_by, reviewed_by, storage_bucket inclus)
    const extraKeys = Object.keys(body).filter(
      k => !CREATE_ALLOWED.has(k) && k !== 'action'
    );
    if (extraKeys.length > 0) {
      return json({ ok: false, error: 'unexpected_fields', fields: extraKeys }, 400, origin);
    }

    // Valider les dates
    if ('expiry_date' in body) {
      const dr = parseDate(body.expiry_date);
      if (!dr.ok) return json({ ok: false, error: 'invalid_date', field: 'expiry_date' }, 400, origin);
    }
    if ('reminder_date' in body) {
      const dr = parseDate(body.reminder_date);
      if (!dr.ok) return json({ ok: false, error: 'invalid_date', field: 'reminder_date' }, 400, origin);
    }

    // Calculé côté serveur — jamais fourni par le client
    const uploadedBy    = actor.id;
    const storageBucket = CAT_BUCKETS[category] ?? 'veraluz-documents-private';

    const insert: Record<string, unknown> = {
      title,
      category,
      confidentiality_level: confLevel,
      status,
      storage_bucket: storageBucket,
      uploaded_by:    uploadedBy,
    };

    const expiryResult   = parseDate(body.expiry_date);
    const reminderResult = parseDate(body.reminder_date);
    const dtype   = optText(body.document_type, 128);
    const relMod  = optText(body.related_module, 64);
    const relRec  = optText(body.related_record_id, 36);
    const notes   = optText(body.notes, 2000);

    if (dtype)              insert.document_type     = dtype;
    if (expiryResult.ok && expiryResult.value !== null)   insert.expiry_date   = expiryResult.value;
    if (reminderResult.ok && reminderResult.value !== null) insert.reminder_date = reminderResult.value;
    if (relMod)             insert.related_module    = relMod;
    if (relRec)             insert.related_record_id = relRec;
    if (notes)              insert.notes             = notes;
    if (Array.isArray(body.tags)) {
      insert.tags = (body.tags as unknown[]).map(t => String(t).slice(0, 64)).slice(0, 20);
    }

    const { data, error } = await db
      .from('veraluz_documents')
      .insert(insert)
      .select('id,title,category,status,storage_bucket,uploaded_by,created_at')
      .single();

    if (error) {
      console.error('[documents-secure] create_failed code=%s msg=%s', error.code, error.message);
      return json({ ok: false, error: 'create_failed' }, 500, origin);
    }
    return json({ ok: true, document: data }, 201, origin);
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if (action === 'update') {
    if (!canManage) {
      return json({ ok: false, error: 'documents_manage_forbidden' }, 403, origin);
    }

    if (!isValidUUID(body.id)) {
      return json({ ok: false, error: 'invalid_id' }, 400, origin);
    }
    const docId = String(body.id);

    // Rejeter champs hors liste blanche (reviewed_by, uploaded_by, storage_bucket, category inclus)
    const extraKeys = Object.keys(body).filter(
      k => !UPDATE_ALLOWED.has(k) && k !== 'action' && k !== 'id'
    );
    if (extraKeys.length > 0) {
      return json({ ok: false, error: 'unexpected_fields', fields: extraKeys }, 400, origin);
    }

    // Valider les dates avant de construire le patch
    if ('expiry_date' in body) {
      const dr = parseDate(body.expiry_date);
      if (!dr.ok) return json({ ok: false, error: 'invalid_date', field: 'expiry_date' }, 400, origin);
    }
    if ('reminder_date' in body) {
      const dr = parseDate(body.reminder_date);
      if (!dr.ok) return json({ ok: false, error: 'invalid_date', field: 'reminder_date' }, 400, origin);
    }

    const patch: Record<string, unknown> = {};

    if ('title' in body) {
      const t = optText(body.title, 255);
      if (!t) return json({ ok: false, error: 'title_required' }, 400, origin);
      patch.title = t;
    }
    if ('document_type' in body)     patch.document_type     = optText(body.document_type, 128);
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
    if ('expiry_date' in body)   patch.expiry_date   = (parseDate(body.expiry_date) as { ok: true; value: string | null }).value;
    if ('reminder_date' in body) patch.reminder_date = (parseDate(body.reminder_date) as { ok: true; value: string | null }).value;
    if ('related_module' in body)    patch.related_module    = optText(body.related_module, 64);
    if ('related_record_id' in body) patch.related_record_id = optText(body.related_record_id, 36);
    if ('notes' in body)             patch.notes             = optText(body.notes, 2000);
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
      console.error('[documents-secure] update_failed code=%s msg=%s', error.code, error.message);
      return json({ ok: false, error: 'update_failed' }, 500, origin);
    }
    if (!data) return json({ ok: false, error: 'document_not_found' }, 404, origin);
    return json({ ok: true, document: data }, 200, origin);
  }

  // ── ARCHIVE ───────────────────────────────────────────────────────────────
  if (action === 'archive') {
    if (!canManage) {
      return json({ ok: false, error: 'documents_manage_forbidden' }, 403, origin);
    }

    if (!isValidUUID(body.id)) {
      return json({ ok: false, error: 'invalid_id' }, 400, origin);
    }
    const docId = String(body.id);

    const { data, error } = await db
      .from('veraluz_documents')
      .update({ status: 'archived' })
      .eq('id', docId)
      .neq('status', 'archived')   // idempotent
      .select('id,title,status,updated_at')
      .maybeSingle();

    if (error) {
      console.error('[documents-secure] archive_failed code=%s msg=%s', error.code, error.message);
      return json({ ok: false, error: 'archive_failed' }, 500, origin);
    }
    return json({ ok: true, document: data }, 200, origin);
  }


  // ── GET_SIGNED_URL ────────────────────────────────────────────────────────
  // Génère une URL de lecture signée (max 15 min) pour un fichier existant.
  // Requiert documents.read. Aucun secret exposé côté navigateur.
  if (action === 'get_signed_url') {
    if (!canRead) {
      return json({ ok: false, error: 'documents_read_forbidden' }, 403, origin);
    }

    if (!isValidUUID(body.id)) {
      return json({ ok: false, error: 'invalid_id' }, 400, origin);
    }
    const docId = String(body.id);

    // Récupérer bucket + path depuis la fiche
    const { data: doc, error: fetchErr } = await db
      .from('veraluz_documents')
      .select('id, storage_bucket, storage_path, file_name, file_type')
      .eq('id', docId)
      .single();

    if (fetchErr || !doc) {
      return json({ ok: false, error: 'document_not_found' }, 404, origin);
    }
    if (!doc.storage_bucket || !doc.storage_path) {
      return json({ ok: false, error: 'no_file_attached' }, 404, origin);
    }

    // Générer l'URL signée — 900 secondes = 15 minutes
    const { data: signedData, error: signErr } = await db.storage
      .from(doc.storage_bucket)
      .createSignedUrl(doc.storage_path, 900);

    if (signErr || !signedData?.signedUrl) {
      console.error('[documents-secure] signed_url_failed', signErr?.message);
      return json({ ok: false, error: 'signed_url_failed' }, 500, origin);
    }

    return json({
      ok:         true,
      url:        signedData.signedUrl,
      expires_in: 900,
      file_name:  doc.file_name,
      file_type:  doc.file_type,
    }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action', action }, 400, origin);
});
