/**
 * VERALUZ — Edge Function : veraluz-document-upload (v1)
 * RECOVERY LOT D.1 — Document Files
 *
 * Méthode      : POST multipart/form-data
 * Auth         : X-Veraluz-Session (SHA-256 hash lookup dans veraluz_employee_sessions)
 * Autorisation : documents.manage → rôle gérant uniquement (socle Lot D)
 * service_role : strictement côté serveur, jamais exposé
 * Buckets      : tous privés, choix côté serveur selon catégorie de la fiche
 *
 * Body attendu (multipart/form-data) :
 *   file        — fichier binaire
 *   document_id — UUID de la fiche existante dans veraluz_documents
 *
 * Types autorisés : PDF, JPEG, PNG, DOCX, XLSX
 * Taille max     : 10 MB (20 MB pour catégories legal / bank / property / identity)
 *
 * Flux :
 *   1. Auth + RBAC
 *   2. Récupérer la fiche existante (catégorie → bucket)
 *   3. Valider MIME, extension, signature binaire, taille
 *   4. Nettoyer le nom de fichier
 *   5. Générer un chemin non devinable
 *   6. Supprimer l'ancien fichier si la fiche avait déjà un storage_path
 *   7. Uploader vers le bucket privé
 *   8. Mettre à jour veraluz_documents
 *      — si l'écriture DB échoue, supprimer l'objet Storage (cleanup)
 * Pas de DELETE de fiche. Pas d'accès direct côté navigateur.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability } from '../_shared/_rbac.ts';
import { crypto } from 'https://deno.land/std@0.177.0/crypto/mod.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

// Buckets privés par catégorie (choix serveur uniquement)
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

// Catégories avec limite haute (20 MB)
const LARGE_LIMIT_CATS = new Set(['legal', 'bank', 'property', 'identity']);
const SIZE_10MB  = 10 * 1024 * 1024;
const SIZE_20MB  = 20 * 1024 * 1024;

// Types MIME autorisés + extensions validées
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
    magic: [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06]], // ZIP
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: ['xlsx'],
    magic: [[0x50, 0x4B, 0x03, 0x04], [0x50, 0x4B, 0x05, 0x06]], // ZIP
  },
};

// ---------------------------------------------------------------------------
// CORS helpers
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
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Nettoyer le nom de fichier — garder uniquement alphanum, tiret, underscore, point */
function sanitizeFilename(name: string): string {
  // Extraire l'extension d'abord
  const lastDot = name.lastIndexOf('.');
  const base    = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext     = lastDot > 0 ? name.slice(lastDot + 1).toLowerCase() : '';
  const cleanBase = base
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // diacritics
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/__+/g, '_')
    .slice(0, 80);
  return ext ? `${cleanBase}.${ext}` : cleanBase;
}

/** Vérifier la signature binaire (magic bytes) */
function checkMagic(bytes: Uint8Array, magics: number[][]): boolean {
  return magics.some(magic =>
    magic.every((b, i) => bytes[i] === b)
  );
}

/** Générer un chemin Storage non devinable */
function generatePath(category: string, documentId: string, filename: string): string {
  const ts  = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${category}/${documentId}/${ts}_${rnd}_${filename}`;
}

// ---------------------------------------------------------------------------
// Auth + RBAC
// ---------------------------------------------------------------------------
async function authenticate(
  req: Request,
  db: ReturnType<typeof createClient>
): Promise<{ actor: { id: string; role: string } } | { error: Response }> {
  const origin = req.headers.get('origin');
  const rawToken = req.headers.get('x-veraluz-session');
  if (!rawToken) return { error: json({ ok: false, code: 'missing_session' }, 401, origin) };

  const tokenHash = await sha256Hex(rawToken);
  const now = new Date().toISOString();

  const { data: session, error } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at')
    .eq('token_hash', tokenHash)
    .eq('is_active', true)
    .single();

  if (error || !session) return { error: json({ ok: false, code: 'invalid_session' }, 401, origin) };
  if (new Date(session.expires_at) < new Date(now))
    return { error: json({ ok: false, code: 'session_expired' }, 401, origin) };

  const { data: emp } = await db
    .from('veraluz_employees')
    .select('id, role')
    .eq('id', session.employee_id)
    .single();

  if (!emp) return { error: json({ ok: false, code: 'employee_not_found' }, 401, origin) };

  return { actor: { id: emp.id, role: emp.role } };
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
    return json({ ok: false, code: 'method_not_allowed' }, 405, origin);
  }

  // Service client (service_role — serveur uniquement)
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Auth
  const authResult = await authenticate(req, db);
  if ('error' in authResult) return authResult.error;
  const { actor } = authResult;

  // RBAC : documents.manage requis
  const role = normalizeRole(actor.role);
  if (!hasCapability(role, 'documents.manage')) {
    return json({ ok: false, code: 'forbidden' }, 403, origin);
  }

  // Parser multipart/form-data
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ ok: false, code: 'invalid_form_data' }, 400, origin);
  }

  const documentId = (formData.get('document_id') ?? '') as string;
  const fileEntry  = formData.get('file') as File | null;

  if (!documentId || !isValidUUID(documentId)) {
    return json({ ok: false, code: 'invalid_document_id' }, 400, origin);
  }
  if (!fileEntry || !(fileEntry instanceof File)) {
    return json({ ok: false, code: 'missing_file' }, 400, origin);
  }

  // Récupérer la fiche existante
  const { data: doc, error: docErr } = await db
    .from('veraluz_documents')
    .select('id, category, storage_bucket, storage_path')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) {
    return json({ ok: false, code: 'document_not_found' }, 404, origin);
  }

  const bucket     = CAT_BUCKETS[doc.category] ?? 'veraluz-documents-private';
  const maxSize    = LARGE_LIMIT_CATS.has(doc.category) ? SIZE_20MB : SIZE_10MB;

  // Lire les bytes
  const fileBuffer = await fileEntry.arrayBuffer();
  const fileBytes  = new Uint8Array(fileBuffer);
  const fileSize   = fileBytes.byteLength;
  const fileMime   = fileEntry.type || 'application/octet-stream';
  const fileName   = sanitizeFilename(fileEntry.name || 'document');

  // Validation taille
  if (fileSize === 0) {
    return json({ ok: false, code: 'file_empty' }, 400, origin);
  }
  if (fileSize > maxSize) {
    return json({
      ok: false,
      code: 'file_too_large',
      max_bytes: maxSize,
      received_bytes: fileSize,
    }, 400, origin);
  }

  // Validation MIME
  const mimeSpec = ALLOWED[fileMime];
  if (!mimeSpec) {
    return json({ ok: false, code: 'mime_not_allowed', received: fileMime }, 400, origin);
  }

  // Validation extension
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!mimeSpec.ext.includes(ext)) {
    return json({ ok: false, code: 'extension_mismatch', ext, mime: fileMime }, 400, origin);
  }

  // Validation signature binaire (magic bytes)
  if (!checkMagic(fileBytes, mimeSpec.magic)) {
    return json({ ok: false, code: 'invalid_file_signature' }, 400, origin);
  }

  // Générer chemin Storage non devinable
  const storagePath = generatePath(doc.category, documentId, fileName);

  // Supprimer l'ancien fichier si existant (pas de doublon)
  if (doc.storage_path && doc.storage_bucket) {
    await db.storage.from(doc.storage_bucket).remove([doc.storage_path]);
    // Échec toléré — on continue
  }

  // Upload vers le bucket privé
  const { error: uploadErr } = await db.storage
    .from(bucket)
    .upload(storagePath, fileBytes, {
      contentType: fileMime,
      upsert: false,
    });

  if (uploadErr) {
    return json({ ok: false, code: 'storage_upload_failed', detail: uploadErr.message }, 500, origin);
  }

  // Mise à jour de la fiche DB
  const { error: dbErr } = await db
    .from('veraluz_documents')
    .update({
      storage_bucket: bucket,
      storage_path:   storagePath,
      file_name:      fileName,
      file_type:      fileMime,
      file_size:      fileSize,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', documentId);

  if (dbErr) {
    // Cleanup : supprimer l'objet uploadé pour éviter les orphelins
    await db.storage.from(bucket).remove([storagePath]);
    return json({ ok: false, code: 'db_update_failed' }, 500, origin);
  }

  return json({
    ok:          true,
    document_id: documentId,
    file_name:   fileName,
    file_size:   fileSize,
    file_type:   fileMime,
    storage_path: storagePath,
    bucket,
  }, 200, origin);
});
