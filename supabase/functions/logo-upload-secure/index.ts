/**
 * SETTINGS-SSOT-1A — logo-upload-secure Edge Function v2
 *
 * Upload sécurisé du logo établissement vers Supabase Storage.
 *
 * Sécurité :
 *   - X-Veraluz-Session requis (employee session valide)
 *   - Capability settings.manage requise (RBAC canonique _rbac.ts)
 *     → gérant : OUI  |  manager : NON (settings.read seulement)  |  autres : NON
 *   - Fichier multipart/form-data — champ "logo"
 *   - Types autorisés : image/png, image/jpeg, image/webp
 *   - Taille max : 2 Mo
 *   - Path généré côté serveur — client ne contrôle pas le nom
 *   - Storage upload avec service_role (jamais exposé frontend)
 *
 * Atomicité :
 *   Storage upload + branding.logo_url DB = opération atomique logique.
 *   Si DB update échoue après Storage upload → cleanup Storage tenté → 5xx.
 *   HTTP 200 uniquement si Storage OK ET DB canonical OK.
 *   Pas de HTTP 207 (succès partiel interdit).
 *
 * v2 (SETTINGS-SSOT-1A hardening):
 *   + hasCapability('settings.manage') remplace DIRECTION_ROLES locale
 *   + Atomicité : cleanup Storage + 5xx si DB échoue
 *   + Suppression HTTP 207
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { hasCapability } from './_rbac.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://dfdmasejsoibxrvubegu.supabase.co',
  'https://ngams237.github.io',
  'http://localhost:3000',
  'http://localhost:8080',
];

const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp']);
const MAX_BYTES    = 2 * 1024 * 1024; /* 2 Mo */
const BUCKET       = 'logos';

const MIME_EXT: Record<string,string> = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function corsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200, extra: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

async function hashToken(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function validateEmployeeSession(db: ReturnType<typeof createClient>, sessionToken: string) {
  if (!sessionToken) return null;
  const hash = await hashToken(sessionToken);
  const { data: sess } = await db
    .from('veraluz_employee_sessions')
    .select('employee_id, expires_at, revoked_at')
    .eq('token_hash', hash)
    .single();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;
  const { data: emp } = await db
    .from('veraluz_employees')
    .select('id, full_name, role')
    .eq('id', sess.employee_id)
    .single();
  return emp ?? null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors   = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405, cors);
  }

  /* ── Auth ─────────────────────────────────────────────────────────────────── */
  const sessionToken = req.headers.get('x-veraluz-session') ?? '';
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const employee = await validateEmployeeSession(db, sessionToken);
  if (!employee) {
    return json({ ok: false, error: 'auth_required' }, 401, cors);
  }

  /* RBAC canonique — capability settings.manage
     gérant : OUI | manager : NON (settings.read seulement) | autres : NON */
  if (!hasCapability(employee.role, 'settings.manage')) {
    return json({
      ok: false,
      error: 'forbidden',
      required_capability: 'settings.manage',
      role: employee.role,
    }, 403, cors);
  }

  /* ── Parse multipart ─────────────────────────────────────────────────────── */
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ ok: false, error: 'multipart_required',
      hint: 'POST multipart/form-data avec champ "logo"' }, 400, cors);
  }

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return json({ ok: false, error: 'invalid_multipart' }, 400, cors); }

  const file = formData.get('logo');
  if (!(file instanceof File)) {
    return json({ ok: false, error: 'logo_field_missing' }, 400, cors);
  }

  /* ── Validation fichier ──────────────────────────────────────────────────── */

  /* Refus base64/dataURL défense en profondeur */
  if (file.name && (file.name.startsWith('data:') || file.name.includes('base64'))) {
    return json({ ok: false, error: 'base64_rejected' }, 400, cors);
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return json({ ok: false, error: 'mime_not_allowed',
      allowed: [...ALLOWED_MIME], received: file.type }, 400, cors);
  }

  if (file.size > MAX_BYTES) {
    return json({ ok: false, error: 'file_too_large',
      max_bytes: MAX_BYTES, received_bytes: file.size }, 400, cors);
  }
  if (file.size === 0) {
    return json({ ok: false, error: 'file_empty' }, 400, cors);
  }

  /* ── Path unique côté serveur ────────────────────────────────────────────
     SETTINGS-SSOT-1A : plus d'upsert sur path fixe.
     Chaque upload génère un path unique (timestamp + random) pour éviter
     toute collision de cache CDN et permettre la suppression best-effort
     de l'ancien objet après succès complet.
     Le client ne contrôle jamais le path.
     Un futur multi-tenant préfixerait par tenant_id ici.              */
  const ext   = MIME_EXT[file.type];
  const ts    = Date.now();
  const rand  = Math.random().toString(36).slice(2, 8);
  const newPath = `veraluz-logo-${ts}-${rand}.${ext}`;

  /* ── Lire l'ancien logo_url AVANT tout upload ─────────────────────────── */
  const { data: existingBranding } = await db
    .from('veraluz_settings')
    .select('value')
    .eq('key', 'branding')
    .maybeSingle();

  /* Extraire l'ancien path Storage depuis l'URL DB (best-effort — null si absent) */
  const oldLogoUrl  = existingBranding?.value?.logo_url as string | undefined;
  const storageBase = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  const oldPath     = oldLogoUrl?.startsWith(storageBase)
    ? oldLogoUrl.slice(storageBase.length)
    : null;

  /* ── Upload Storage — nouveau path unique ────────────────────────────── */
  const arrayBuffer = await file.arrayBuffer();
  const { error: storageErr } = await db.storage
    .from(BUCKET)
    .upload(newPath, arrayBuffer, {
      contentType: file.type,
      upsert:      false,   /* path unique → pas d'upsert nécessaire */
    });

  if (storageErr) {
    console.error('[logo-upload-secure] Storage error:', storageErr.message);
    return json({ ok: false, error: 'storage_error', detail: storageErr.message }, 500, cors);
  }

  /* ── URL publique ─────────────────────────────────────────────────────── */
  const { data: publicData } = db.storage.from(BUCKET).getPublicUrl(newPath);
  const publicUrl = publicData?.publicUrl
    ?? `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${newPath}`;

  /* ── Persister branding.logo_url en DB ──────────────────────────────── */
  const merged = Object.assign({}, existingBranding?.value ?? {}, { logo_url: publicUrl });
  const { error: dbErr } = await db
    .from('veraluz_settings')
    .upsert({ key: 'branding', value: merged, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (dbErr) {
    /* ATOMICITÉ : Storage a réussi mais DB a échoué.
       Supprimer UNIQUEMENT le NOUVEL objet uploadé — l'ancien logo reste intact.
       Ne pas retourner 207 (succès partiel interdit).
       HTTP 500 — le client devra réessayer l'opération complète.          */
    console.error('[logo-upload-secure] DB persist error — cleaning up NEW upload:', dbErr.message);
    const { error: removeErr } = await db.storage.from(BUCKET).remove([newPath]);
    if (removeErr) {
      console.error('[logo-upload-secure] Storage cleanup of new object failed:', removeErr.message);
    }
    return json({
      ok:    false,
      error: 'db_write_error',
      detail: dbErr.message,
      storage_cleanup_attempted: true,
      old_logo_preserved: true,
    }, 500, cors);
  }

  /* ── Succès complet : Storage OK + DB canonical OK ──────────────────────
     Supprimer l'ANCIEN objet best-effort — échec non bloquant.
     L'ancien path n'est supprimé qu'après que les deux opérations critiques
     (Storage + DB) ont réussi.                                             */
  if (oldPath && oldPath !== newPath) {
    const { error: oldRemoveErr } = await db.storage.from(BUCKET).remove([oldPath]);
    if (oldRemoveErr) {
      console.warn('[logo-upload-secure] Old logo cleanup failed (non-blocking):', oldRemoveErr.message);
    } else {
      console.log('[logo-upload-secure] Old logo removed:', oldPath);
    }
  }

  return json({
    ok:           true,
    url:          publicUrl,
    db_persisted: true,
    path:         newPath,
    old_path_removed: oldPath && oldPath !== newPath ? true : null,
    uploaded_by:  employee.full_name,
  }, 200, cors);
});
