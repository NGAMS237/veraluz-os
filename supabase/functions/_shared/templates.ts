/**
 * _shared/templates.ts — Rendu déterministe de templates de communication
 *
 * Règles absolues :
 *  - JAMAIS de eval(), Function(), template literals dynamiques
 *  - Variables whitelistées uniquement (whitelist TEMPLATE_VARS)
 *  - Rendu synchrone, déterministe, pas d'IA
 *  - Variables manquantes → chaîne vide (pas d'erreur)
 */

// ── Whitelist des variables autorisées ────────────────────────
export const TEMPLATE_VARS = [
  'guest_name',
  'check_in',
  'check_out',
  'unit_name',
  'property_name',
  'reception_phone',
  'reservation_id',
] as const;

export type TemplateVar = typeof TEMPLATE_VARS[number];
export type TemplateContext = Partial<Record<TemplateVar, string>>;

// ── Rendu déterministe ────────────────────────────────────────
/**
 * renderTemplate(template, context)
 * Remplace {{variable}} dans `template` par la valeur de `context[variable]`.
 * Seules les variables de TEMPLATE_VARS sont remplacées.
 * Une variable absente du contexte est remplacée par une chaîne vide.
 * Le template n'est jamais exécuté — uniquement substitution de chaînes.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  let result = template;
  for (const key of TEMPLATE_VARS) {
    const value = context[key] ?? '';
    // Remplacement global : {{key}} → value (sécurisé, pas de regex user-input)
    result = result.split(`{{${key}}}`).join(value);
  }
  return result;
}

/**
 * renderSubject et renderBody : wrappers typés pour lisibilité
 */
export function renderSubject(subject: string, context: TemplateContext): string {
  return renderTemplate(subject, context);
}

export function renderBody(body: string, context: TemplateContext): string {
  return renderTemplate(body, context);
}
