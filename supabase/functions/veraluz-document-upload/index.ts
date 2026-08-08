/**
 * VERALUZ — Edge Function : veraluz-document-upload
 * PROMPT 019 — Placeholder sécurisé
 *
 * STATUT : NON ACTIVÉ EN PRODUCTION
 * Cette fonction n'est pas encore configurée pour l'upload réel.
 * Elle sera complétée dans PROMPT 020+.
 *
 * ARCHITECTURE PRÉVUE :
 * 1. Le frontend envoie les métadonnées + le fichier à cette Edge Function
 * 2. L'Edge Function valide le fichier (type, taille, signature)
 * 3. L'Edge Function utilise service_role (côté serveur uniquement) pour uploader
 *    dans le bucket privé approprié (veraluz-hr-private, veraluz-legal-private, etc.)
 * 4. L'Edge Function retourne l'ID du document mis à jour dans veraluz_documents
 *
 * RÈGLES DE SÉCURITÉ :
 * - service_role JAMAIS dans le frontend
 * - Aucun bucket public pour documents sensibles
 * - URL signée max 15 minutes pour accès lecture
 * - Validation type MIME et taille avant upload
 * - Audit log de chaque upload dans veraluz_auth_events
 *
 * Types autorisés : PDF, JPEG, PNG, DOCX, XLSX
 * Taille maximale : 10 MB (20 MB pour documents juridiques)
 *
 * IMPORTANT : Ne pas déployer sans configurer les secrets Supabase :
 *   supabase secrets set VERALUZ_SERVICE_ROLE_KEY=...
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://ngams237.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // PLACEHOLDER — Upload non configuré
  // À compléter dans PROMPT 020+ avec :
  // - Validation du token utilisateur
  // - Vérification du rôle (superadmin, manager, rh, finance)
  // - Validation type MIME et taille fichier
  // - Upload via supabaseAdmin (service_role) dans le bon bucket privé
  // - Mise à jour de veraluz_documents avec storage_path
  // - Log dans veraluz_auth_events

  return new Response(
    JSON.stringify({
      ok: false,
      message: 'Document upload not configured yet',
      details: 'Cette Edge Function sera activée dans PROMPT 020. Utilisez le mode métadonnées uniquement pour le moment.',
      next_prompt: 'PROMPT 020 — Paie formelle + activation upload sécurisé',
    }),
    {
      status: 503,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
      },
    }
  );
});
