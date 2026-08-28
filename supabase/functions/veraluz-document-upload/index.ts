/**
 * VERALUZ — Edge Function : veraluz-document-upload (v2 hardened)
 * RECOVERY LOT D.1 — HARDENING
 *
 * Corrections v2 :
 *  - Auth alignée sur documents-secure (revoked_at IS NULL, expires_at, status actif)
 *  - Origine non autorisée → 403
 *  - Remplacement atomique : nouveau upload → CAS DB → rollback nouveau si DB échoue →
 *    suppression ancien seulement après réussite DB
 *  - Chemin Storage via crypto.randomUUID() (non devinable)
 *  - Limites taille par bucket : legal 20 MB, bank 5 MB, hr/documents 10 MB
 *  - Vérification interne DOCX/XLSX (présence de la signature Office dans le ZIP)
 *  - Aucun message technique Storage/DB retourné au navigateur
 *  - Réponse : has_file, file_name, file_type, file_size uniquement (pas de path/bucket)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability } from '../_shared/_rbac.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'https://NGAMS237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

const ACTIVE_STATUSES = new Set(['actif', 'active']);

// Buckets privés par catégorie (décision serveur)
const CAT_BUCKETS: Record<string, string> = {
  legal:      'veraluz-legal-private',
  property:   'veraluz-legal-private',
  identity:   'veraluz-legal-private',
  bank:       'veraluz-bank-private',
  hr:         'veraluz-hr-private',
  tax:        'veraluz-documents-private',
  supplier:   'veraluz-documents-private',
  insurance:  'veraluz-documents-private',
  finance:    'veraluz-documents-private',
  operations: 'veraluz-documents-private',
  other:      'veraluz-documents-private',
};

// Limite de taille par bucket (en octets)
const BUCKET_MAX_SIZE: Record<string, number> = {
  'veraluz-legal-private':     20 * 1024 * 1024,
  'veraluz-bank-private':       5 * 1024 * 1024,
  'veraluz-hr-private':        10 * 1024 * 1024,
  'veraluz-documents-private': 10 * 1024 * 1024,
};

// Types MIME autorisés : MIME → { ext, magic }
const ALLOWED: Record<string, { ext: string[]; magic: number[][] }> = {
  'application/pdf': {
    ext: ['pdf'],
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  'image/jpeg': {
    ext: ['jpg', 'jpeg'],
    magic: [[0xFF, 0xD8, 0xFF]],
  },
  'image/png': {
    ext: ['png'],
    magic: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: ['docx'],
    magic: [[0x50, 0x4B, 0x03, 0x04]], // ZIP
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: ['xlsx'],
    magic: [[0x50, 0x4B, 0x03, 0x04]], // ZIP
  },
};

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
// Helpers
// ---------------------------------------------------------------------------
function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeFilename(name: string): string {
  const lastDot  = name.lastIndexOf('.');
  const base     = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext      = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : '';
  const cleanBase = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/__+/g, '_')
    .slice(0, 80);
  return ext ? `${cleanBase}.${ext}` : cleanBase;
}

function checkMagic(bytes: Uint8Array, magics: number[][]): boolean {
  return magics.some(magic => magic.every((b, i) => bytes[i] === b));
}

/**
 * Vérifie la présence de la signature Office interne dans un ZIP.
 * DOCX → wordprocessingml, XLSX → spreadsheetml (dans [Content_Types].xml).
 */
function hasOfficeSignature(bytes: Uint8Array, kind: 'docx' | 'xlsx'): boolean {
  const needle = new TextEncoder().encode(
    kind === 'docx' ? 'wordprocessingml' : 'spreadsheetml'
  );
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Chemin Storage non devinable via UUID v4 */
function generatePath(category: string, documentId: string, filename: string): string {
  const uid = crypto.randomUUID();
  return `${category}/${documentId}/${uid}_${filename}`;
}

// ---------------------------------------------------------------------------
// Auth alignée sur documents-secure
// ---------------------------------------------------------------------------
async function authenticate(
  req: Request,
  db: ReturnType<typeof createClient>,
  origin: string | null,
): Promise<{ actor: { id: string; role: string } } | { error: Response }> {
  const rawToken = req.headers.get('x-veraluz-session');
  if (!rawToken || rawToken.length < 16) {
    return { error: json({ ok: false, error: 'unauthorized' }, 401, origin) };
  }

  const tokenHash = await sha256Hex(rawToken);

  const { data: session, error: sessionErr } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (sessionErr) {
    console.error('[veraluz-document-upload] session_lookup_error');
    return { error: json({ ok: false, error: 'server_error' }, 500, origin) };
  }
  if (!session) {
    return { error: json({ ok: false, error: 'unauthorized' }, 401, origin) };
  }

  const { data: emp, error: empErr } = await db
    .from('veraluz_employees')
    .select('id, role, status')
    .eq('id', session.employee_id)
    .maybeSingle();

  if (empErr) {
    console.error('[veraluz-document-upload] employee_lookup_error');
    return { error: json({ ok: false, error: 'server_error' }, 500, origin) };
  }
  if (!emp || !ACTIVE_STATUSES.has(String(emp.status || '').toLowerCase())) {
    return { error: json({ ok: false, error: 'unauthorized' }, 401, origin) };
  }

  return { actor: { id: String(emp.id), role: normalizeRole(emp.role) } };
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  // Origine non autorisée → 403
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ ok: false, error: 'forbidden_origin' }, 403, origin);
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Auth
  const authResult = await authenticate(req, db, origin);
  if ('error' in authResult) return authResult.error;
  const { actor } = authResult;

  // RBAC : documents.manage obligatoire
  if (!hasCapability(actor.role, 'documents.manage')) {
    return json({ ok: false, error: 'documents_manage_forbidden' }, 403, origin);
  }

  // Parser multipart/form-data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form_data' }, 400, origin);
  }

  const documentId = String(formData.get('document_id') ?? '').trim();
  const fileEntry  = formData.get('file') as File | null;

  if (!isValidUUID(documentId)) {
    return json({ ok: false, error: 'invalid_document_id' }, 400, origin);
  }
  if (!fileEntry || !(fileEntry instanceof File)) {
    return json({ ok: false, error: 'missing_file' }, 400, origin);
  }

  // Récupérer la fiche (catégorie + fichier actuel)
  const { data: doc, error: docErr } = await db
    .from('veraluz_documents')
    .select('id, category, storage_bucket, storage_path')
    .eq('id', documentId)
    .maybeSingle();

  if (docErr) {
    console.error('[veraluz-document-upload] doc_fetch_error');
    return json({ ok: false, error: 'server_error' }, 500, origin);
  }
  if (!doc) {
    return json({ ok: false, error: 'document_not_found' }, 404, origin);
  }

  const bucket  = CAT_BUCKETS[doc.category] ?? 'veraluz-documents-private';
  const maxSize = BUCKET_MAX_SIZE[bucket] ?? (10 * 1024 * 1024);

  // Lire le fichier
  const fileBuffer = await fileEntry.arrayBuffer();
  const fileBytes  = new Uint8Array(fileBuffer);
  const fileSize   = fileBytes.byteLength;
  const fileMime   = fileEntry.type || 'application/octet-stream';
  const fileName   = sanitizeFilename(fileEntry.name || 'document');

  if (fileSize === 0) {
    return json({ ok: false, error: 'file_empty' }, 400, origin);
  }
  if (fileSize > maxSize) {
    return json({ ok: false, error: 'file_too_large' }, 413, origin);
  }

  // Validation MIME
  const mimeSpec = ALLOWED[fileMime];
  if (!mimeSpec) {
    return json({ ok: false, error: 'invalid_file_type' }, 415, origin);
  }

  // Validation extension
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!mimeSpec.ext.includes(ext)) {
    return json({ ok: false, error: 'invalid_file_type' }, 415, origin);
  }

  // Validation magic bytes (signature binaire)
  if (!checkMagic(fileBytes, mimeSpec.magic)) {
    return json({ ok: false, error: 'invalid_file_content' }, 415, origin);
  }

  // Validation Office interne (DOCX / XLSX)
  if (fileMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (!hasOfficeSignature(fileBytes, 'docx')) {
      return json({ ok: false, error: 'invalid_file_content' }, 415, origin);
    }
  }
  if (fileMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    if (!hasOfficeSignature(fileBytes, 'xlsx')) {
      return json({ ok: false, error: 'invalid_file_content' }, 415, origin);
    }
  }

  // ── REMPLACEMENT ATOMIQUE ────────────────────────────────────────────────
  // 1. Uploader LE NOUVEAU fichier d'abord
  const storagePath = generatePath(doc.category, documentId, fileName);

  const { error: uploadErr } = await db.storage
    .from(bucket)
    .upload(storagePath, fileBytes, { contentType: fileMime, upsert: false });

  if (uploadErr) {
    console.error('[veraluz-document-upload] upload_failed');
    return json({ ok: false, error: 'upload_failed' }, 500, origin);
  }

  // 2. Mettre à jour DB (CAS : select('id') pour vérifier 1 ligne affectée)
  const { data: updated, error: dbErr } = await db
    .from('veraluz_documents')
    .update({
      storage_bucket: bucket,
      storage_path:   storagePath,
      file_name:      fileName,
      file_type:      fileMime,
      file_size:      fileSize,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', documentId)
    .select('id');

  if (dbErr || !updated || updated.length === 0) {
    // Rollback : supprimer le nouveau fichier uploadé
    await db.storage.from(bucket).remove([storagePath]);
    console.error('[veraluz-document-upload] db_update_failed — new file rolled back');
    return json({ ok: false, error: 'db_update_failed' }, 500, origin);
  }

  // 3. Supprimer l'ANCIEN fichier (seulement après réussite DB)
  if (doc.storage_path && doc.storage_bucket) {
    await db.storage.from(doc.storage_bucket).remove([doc.storage_path]);
    // Échec toléré — l'ancien fichier devient orphelin mais la fiche est à jour
  }

  // Réponse : aucun path/bucket exposé
  return json({
    ok:        true,
    document_id: documentId,
    has_file:  true,
    file_name: fileName,
    file_type: fileMime,
    file_size: fileSize,
  }, 200, origin);
});
