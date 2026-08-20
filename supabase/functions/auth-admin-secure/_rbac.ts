/**
 * AUTH-R5 — _rbac.ts
 * Source canonique des roles et capabilities VERALUZ.
 */

export const ROLE_ALIASES: Record<string, string> = {
  'gerant':'gerant','gérant':'gerant','directeur':'gerant','directrice':'gerant',
  'direction':'gerant','admin':'gerant','administrateur':'gerant',
  'superadmin':'gerant','proprietaire':'gerant','owner':'gerant',
  'manager':'manager','superviseur':'manager','chef_equipe':'manager',
  'receptionniste':'receptionniste','receptioniste':'receptionniste',
  'agent_accueil':'receptionniste','reception':'receptionniste',
  'barman':'barman','serveur':'barman','restaurant':'barman','waiter':'barman',
  'cuisinier':'cuisinier','chef':'cuisinier','chef_cuisinier':'cuisinier',
  'kitchen':'cuisinier','aide_cuisine':'cuisinier','cook':'cuisinier','cuisine':'cuisinier',
  'femme_chambre':'femme_chambre','agent_menage':'femme_chambre',
  'housekeeping':'femme_chambre','menage':'femme_chambre',
  'cleaner':'femme_chambre','housekeeper':'femme_chambre',
  'livreur':'livreur','coursier':'livreur','driver':'livreur',
  'delivery':'livreur','chauffeur':'livreur',
  'comptable':'comptable','financier':'comptable','finance':'comptable','accountant':'comptable',
  'rh':'rh','ressources_humaines':'rh','hr':'rh',
  'technicien':'technicien','maintenance':'technicien',
  'plombier':'technicien','electricien':'technicien',
  'agent_securite':'agent_securite',
  'staff':'staff','agent':'staff','employe':'staff',
};

export function normalizeRole(role: unknown): string {
  const r = String(role || '').trim().toLowerCase();
  return ROLE_ALIASES[r] ?? r;
}

const ROLE_CAPS: Record<string, readonly string[]> = {
  gerant: [
    'reservations.read','reservations.write','reservations.checkin','reservations.checkout',
    'payments.read','payments.record','payments.manage',
    'restaurant.read','restaurant.order','restaurant.stock','restaurant.room_service','restaurant.assign',
    'housekeeping.read','housekeeping.update',
    'finance.read','finance.manage',
    'employees.directory','employees.manage',
    'messages.read','messages.send','messages.admin',
    'reports.read','settings.read','settings.manage',
    'auth.users.manage','auth.sessions.manage','auth.sessions.read','auth.audit.read',
  ],
  manager: [
    'reservations.read','reservations.write','reservations.checkin','reservations.checkout',
    'payments.read','payments.record',
    'restaurant.read','restaurant.order','restaurant.stock','restaurant.room_service','restaurant.assign',
    'housekeeping.read','housekeeping.update',
    'finance.read','employees.directory','employees.manage',
    'messages.read','messages.send','messages.admin',
    'reports.read','settings.read',
  ],
  receptionniste: [
    'reservations.read','reservations.write','reservations.checkin','reservations.checkout',
    'payments.read','payments.record',
    'employees.directory','messages.read','messages.send',
    'settings.read','housekeeping.read',
    'restaurant.room_service','restaurant.assign',
  ],
  barman: [
    'restaurant.read','restaurant.order','restaurant.stock','restaurant.room_service','restaurant.assign',
    'messages.read','messages.send',
  ],
  cuisinier: ['restaurant.read','restaurant.stock','messages.read','messages.send'],
  femme_chambre: ['housekeeping.read','housekeeping.update','messages.read','messages.send'],
  livreur: ['restaurant.room_service','messages.read'],
  comptable: [
    'finance.read','finance.manage','payments.read','reports.read',
    'employees.directory','messages.read','messages.send','settings.read',
  ],
  rh: ['employees.directory','employees.manage','messages.read','messages.send','reports.read'],
  technicien: ['housekeeping.read','messages.read','employees.directory'],
  agent_securite: ['employees.directory','messages.read'],
  staff: ['messages.read'],
};

const _CAPS_MAP: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(ROLE_CAPS).map(([role, caps]) => [role, new Set(caps)])
);

export function hasCapability(role: unknown, capability: string): boolean {
  return _CAPS_MAP[normalizeRole(role)]?.has(capability) ?? false;
}

export function getRoleCapabilities(role: unknown): string[] {
  return [...(_CAPS_MAP[normalizeRole(role)] ?? [])].sort();
}

export function getFullRbacMatrix(): Record<string, string[]> {
  return Object.fromEntries(Object.entries(ROLE_CAPS).map(([r, c]) => [r, [...c]]));
}

export function isPrivilegedRole(role: unknown): boolean {
  return hasCapability(role, 'auth.users.manage');
}
