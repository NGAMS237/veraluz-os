/**
 * AUTH-R1C1 — employees-secure
 *
 * API canonique employes pour CORE, Contacts, Restaurant, Analytics et RH.
 * L'identite et les permissions du demandeur proviennent exclusivement de
 * X-Veraluz-Session. Le service_role reste strictement cote serveur.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

const ACTIVE_STATUSES = new Set(['actif', 'active']);
const VALID_EMPLOYEE_STATUSES = new Set(['actif', 'active', 'conge', 'inactif', 'inactive']);

const ROLE_CLASS: Record<string, string> = {
  gerant: 'superadmin', directeur: 'superadmin', direction: 'superadmin',
  directrice: 'superadmin', admin: 'superadmin', administrateur: 'superadmin',
  superadmin: 'superadmin', proprietaire: 'superadmin', owner: 'superadmin',
  manager: 'manager', superviseur: 'manager', chef_equipe: 'manager',
  receptionniste: 'reception', receptioniste: 'reception',
  agent_accueil: 'reception', reception: 'reception',
  comptable: 'accountant', financier: 'accountant', finance: 'accountant',
  accountant: 'accountant',
  rh: 'rh', ressources_humaines: 'rh', hr: 'rh',
  barman: 'restaurant', serveur: 'restaurant', restaurant: 'restaurant', waiter: 'restaurant',
  cuisinier: 'kitchen', chef: 'kitchen', chef_cuisinier: 'kitchen',
  kitchen: 'kitchen', aide_cuisine: 'kitchen', cook: 'kitchen', cuisine: 'kitchen',
};

const DIRECTORY_ROLE_CLASSES = new Set(['superadmin', 'manager', 'reception']);
const OPERATIONAL_ROLE_CLASSES = new Set(['superadmin', 'manager', 'restaurant', 'kitchen']);
const ANALYTICS_ROLE_CLASSES = new Set(['superadmin', 'accountant']);
const RH_ROLE_CLASSES = new Set(['superadmin', 'manager', 'rh']);

const RH_LIST_PROJECTION = [
  'id', 'full_name', 'phone', 'email', 'role', 'team_id', 'status', 'hire_date',
  'base_salary', 'hourly_rate', 'contract_type', 'photo_url', 'notes',
  'momo_number', 'bank_account', 'must_change_pin', 'public_display_name',
  'identity_verified', 'department', 'created_at',
].join(',');

const RH_CREATE_FIELDS = new Set([
  'full_name', 'phone', 'email', 'role', 'team_id', 'hire_date',
  'base_salary', 'momo_number', 'status', 'notes',
]);
const RH_UPDATE_FIELDS = new Set([
  'full_name', 'phone', 'email', 'role', 'team_id', 'hire_date',
  'momo_number', 'notes',
]);

type Actor = { id: string; role: string; roleClass: string };
type DbClient = ReturnType<typeof createClient>;

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-veraluz-session',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function roleClass(role: unknown) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_CLASS[normalized] || normalized;
}

async function validateEmployeeSession(
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
    console.error('[employees-secure] session_lookup_failed code=', sessionError.code);
    return { actor: null, serverError: true };
  }
  if (!session) return { actor: null, serverError: false };

  const { data: employee, error: employeeError } = await db
    .from('veraluz_employees')
    .select('id,role,status')
    .eq('id', session.employee_id)
    .maybeSingle();

  if (employeeError) {
    console.error('[employees-secure] actor_lookup_failed code=', employeeError.code);
    return { actor: null, serverError: true };
  }
  if (!employee || !ACTIVE_STATUSES.has(String(employee.status || '').toLowerCase())) {
    return { actor: null, serverError: false };
  }

  return {
    actor: {
      id: String(employee.id),
      role: String(employee.role || '').toLowerCase(),
      roleClass: roleClass(employee.role),
    },
    serverError: false,
  };
}

function requireRole(actor: Actor, allowed: Set<string>) {
  return allowed.has(actor.roleClass);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateFields(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalText(value: unknown, maxLength: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requiredName(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized.length >= 2 && normalized.length <= 160 ? normalized : null;
}

function validRole(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,63}$/.test(normalized) ? normalized : null;
}

function validStatus(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_EMPLOYEE_STATUSES.has(normalized) ? normalized : null;
}

function validDate(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function validAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function targetEmployeeId(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

async function selectRhEmployees(db: DbClient) {
  const { data: employees, error } = await db
    .from('veraluz_employees')
    .select(RH_LIST_PROJECTION)
    .order('full_name', { ascending: true });
  if (error) return { employees: null, error };

  const { data: secretRows, error: secretError } = await db
    .from('veraluz_employee_auth_secrets')
    .select('employee_id');
  if (secretError) return { employees: null, error: secretError };

  const provisioned = new Set((secretRows || []).map((row) => String(row.employee_id)));
  return {
    employees: (employees || []).map((employee) => ({
      ...employee,
      access_provisioned: provisioned.has(String(employee.id)),
    })),
    error: null,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return json({ ok: false, error: 'forbidden_origin' }, 403, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, origin);
  }

  const sessionToken = req.headers.get('x-veraluz-session')?.trim() || '';
  if (!sessionToken) return json({ ok: false, error: 'session_required' }, 401, origin);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const validation = await validateEmployeeSession(db, sessionToken);
  if (validation.serverError) return json({ ok: false, error: 'server_error' }, 500, origin);
  if (!validation.actor) {
    return json({ ok: false, error: 'invalid_or_expired_session' }, 401, origin);
  }

  const actor = validation.actor;
  const action = String(body.action || '').trim();
  if (!action) return json({ ok: false, error: 'action_required' }, 400, origin);

  if (action === 'get_my_profile') {
    const { data: profile, error } = await db
      .from('veraluz_employees')
      .select('id,full_name,phone,email,hire_date,team_id')
      .eq('id', actor.id)
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] get_my_profile_failed code=', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    if (!profile) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, profile }, 200, origin);
  }

  if (action === 'list_directory') {
    if (!requireRole(actor, DIRECTORY_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const { data: employees, error } = await db
      .from('veraluz_employees')
      .select('id,full_name,role,email,phone,status')
      .order('full_name', { ascending: true });
    if (error) {
      console.error('[employees-secure] list_directory_failed code=', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, employees: employees || [] }, 200, origin);
  }

  if (action === 'list_operational_roster') {
    if (!requireRole(actor, OPERATIONAL_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const { data: employees, error } = await db
      .from('veraluz_employees')
      .select('id,full_name,role,status,photo_url,public_display_name,public_role_label,identity_verified,team:veraluz_teams(id,name)')
      .in('status', ['actif', 'active'])
      .order('full_name', { ascending: true });
    if (error) {
      console.error('[employees-secure] list_operational_roster_failed code=', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, employees: employees || [] }, 200, origin);
  }

  if (action === 'list_analytics') {
    if (!requireRole(actor, ANALYTICS_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const { data: employees, error } = await db
      .from('veraluz_employees')
      .select('id,full_name,role,status,base_salary,contract_type')
      .order('full_name', { ascending: true });
    if (error) {
      console.error('[employees-secure] list_analytics_failed code=', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, employees: employees || [] }, 200, origin);
  }

  if (action === 'rh_list') {
    if (!requireRole(actor, RH_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const result = await selectRhEmployees(db);
    if (result.error) {
      console.error('[employees-secure] rh_list_failed code=', result.error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, employees: result.employees || [] }, 200, origin);
  }

  if (action === 'rh_create') {
    if (!requireRole(actor, RH_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const input = body.employee;
    if (!isPlainObject(input) || !validateFields(input, RH_CREATE_FIELDS)) {
      return json({ ok: false, error: 'invalid_employee_fields' }, 400, origin);
    }

    const fullName = requiredName(input.full_name);
    const role = validRole(input.role || 'staff');
    const status = validStatus(input.status || 'actif');
    const hireDate = validDate(input.hire_date);
    const baseSalary = validAmount(input.base_salary ?? 0);
    if (!fullName || !role || !status || hireDate === undefined || baseSalary === null) {
      return json({ ok: false, error: 'invalid_employee_data' }, 400, origin);
    }

    const row = {
      full_name: fullName,
      phone: optionalText(input.phone, 64),
      email: optionalText(input.email, 254),
      role,
      team_id: optionalText(input.team_id, 128),
      hire_date: hireDate,
      base_salary: baseSalary,
      momo_number: optionalText(input.momo_number, 64),
      status,
      notes: optionalText(input.notes, 2000),
      pin_code: null,
      must_change_pin: false,
    };

    const { data: employee, error } = await db
      .from('veraluz_employees')
      .insert(row)
      .select(RH_LIST_PROJECTION)
      .single();
    if (error) {
      console.error('[employees-secure] rh_create_failed code=', error.code);
      return json({ ok: false, error: 'employee_create_failed' }, 500, origin);
    }
    return json({ ok: true, employee: { ...employee, access_provisioned: false } }, 201, origin);
  }

  if (action === 'rh_update') {
    if (!requireRole(actor, RH_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const employeeId = targetEmployeeId(body.employee_id);
    const input = body.employee;
    if (!employeeId || !isPlainObject(input) || !validateFields(input, RH_UPDATE_FIELDS)) {
      return json({ ok: false, error: 'invalid_employee_fields' }, 400, origin);
    }

    const update: Record<string, unknown> = {};
    if ('full_name' in input) {
      const name = requiredName(input.full_name);
      if (!name) return json({ ok: false, error: 'invalid_employee_data' }, 400, origin);
      update.full_name = name;
    }
    if ('role' in input) {
      const role = validRole(input.role);
      if (!role) return json({ ok: false, error: 'invalid_employee_data' }, 400, origin);
      update.role = role;
    }
    if ('hire_date' in input) {
      const hireDate = validDate(input.hire_date);
      if (hireDate === undefined) return json({ ok: false, error: 'invalid_employee_data' }, 400, origin);
      update.hire_date = hireDate;
    }
    if ('phone' in input) update.phone = optionalText(input.phone, 64);
    if ('email' in input) update.email = optionalText(input.email, 254);
    if ('team_id' in input) update.team_id = optionalText(input.team_id, 128);
    if ('momo_number' in input) update.momo_number = optionalText(input.momo_number, 64);
    if ('notes' in input) update.notes = optionalText(input.notes, 2000);
    if (!Object.keys(update).length) {
      return json({ ok: false, error: 'no_employee_fields' }, 400, origin);
    }

    const { data: employee, error } = await db
      .from('veraluz_employees')
      .update(update)
      .eq('id', employeeId)
      .select(RH_LIST_PROJECTION)
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] rh_update_failed code=', error.code);
      return json({ ok: false, error: 'employee_update_failed' }, 500, origin);
    }
    if (!employee) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, employee }, 200, origin);
  }

  if (action === 'rh_set_status') {
    if (!requireRole(actor, RH_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const employeeId = targetEmployeeId(body.employee_id);
    const status = validStatus(body.status);
    if (!employeeId || !status) return json({ ok: false, error: 'invalid_status' }, 400, origin);

    const { data: employee, error } = await db
      .from('veraluz_employees')
      .update({ status })
      .eq('id', employeeId)
      .select('id,status')
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] rh_set_status_failed code=', error.code);
      return json({ ok: false, error: 'employee_status_update_failed' }, 500, origin);
    }
    if (!employee) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, employee }, 200, origin);
  }

  if (action === 'rh_update_compensation') {
    if (!requireRole(actor, RH_ROLE_CLASSES)) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const employeeId = targetEmployeeId(body.employee_id);
    const baseSalary = validAmount(body.base_salary);
    if (!employeeId || baseSalary === null) {
      return json({ ok: false, error: 'invalid_compensation' }, 400, origin);
    }

    const { data: employee, error } = await db
      .from('veraluz_employees')
      .update({ base_salary: baseSalary })
      .eq('id', employeeId)
      .select('id,base_salary')
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] rh_update_compensation_failed code=', error.code);
      return json({ ok: false, error: 'employee_compensation_update_failed' }, 500, origin);
    }
    if (!employee) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, employee }, 200, origin);
  }

  return json({ ok: false, error: 'unknown_action' }, 400, origin);
});
