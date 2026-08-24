/**
 * AUTH-R1C1 — employees-secure
 *
 * API canonique employes pour CORE, Contacts, Restaurant, Analytics et RH.
 * L'identite et les permissions du demandeur proviennent exclusivement de
 * X-Veraluz-Session. Le service_role reste strictement cote serveur.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeRole, hasCapability, isPrivilegedRole } from './_rbac.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = [
  'https://ngams237.github.io',
  'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:8080',
];

const ACTIVE_STATUSES = new Set(['actif', 'active']);
const VALID_EMPLOYEE_STATUSES = new Set(['actif', 'active', 'conge', 'inactif', 'inactive']);

// AUTH-R5 : normalisation et capabilities via _rbac.ts (source canonique)

// Liste fermée alignée sur ROLE_MAP (CORE) et le sélecteur RH existant.
// AUTH-R5 décidera plus tard d'une éventuelle source RBAC canonique en DB.
const KNOWN_EMPLOYEE_ROLES = new Set([
  'gerant','directeur','directrice','direction','admin','administrateur','superadmin','proprietaire','owner',
  'femme_chambre', 'agent_menage', 'housekeeping', 'menage', 'cleaner', 'housekeeper',
  'technicien', 'maintenance', 'plombier', 'electricien', 'agent_securite',
  'livreur', 'coursier', 'driver', 'delivery', 'chauffeur',
  'staff', 'agent', 'employe',
]);

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
const GET_MY_DELIVERY_PROFILE_FIELDS = new Set(['action']);
const GET_MY_DELIVERY_SHIFT_FIELDS = new Set(['action']);
const PUNCH_MY_DELIVERY_SHIFT_FIELDS = new Set(['action', 'event']);
const RECORD_MY_DELIVERY_CHECKIN_FIELDS = new Set(['action', 'checkin_type', 'selfie_url', 'device_info']);
const UPDATE_MY_PHOTO_FIELDS = new Set(['action', 'photo_url']);
const UPDATE_MY_PROFILE_FIELDS = new Set(['action', 'civility', 'first_name', 'last_name', 'phone', 'email', 'photo_url']);
const SELF_WORKSPACE_FIELDS = new Set(['action']);
const PUNCH_SELF_FIELDS = new Set(['action', 'event']);
const COMPLETE_MY_TASK_FIELDS = new Set(['action', 'task_id']);
const RH_READ_FIELDS = new Set(['action', 'resource']);
const RH_WRITE_FIELDS = new Set(['action', 'resource', 'operation', 'record_id', 'values']);
const RH_SETTINGS_FIELDS = new Set(['action', 'settings']);
const TENANT_ID = 'veraluz-001';

/* Bridge de compatibilité Recovery Lot A. Les noms de table et colonnes sont
   fermés côté serveur; le rôle JS du navigateur n'intervient jamais. */
const RH_RESOURCE_FIELDS: Record<string, Set<string>> = {
  veraluz_teams: new Set(['id','name','description','color','icon','created_at']),
  veraluz_contracts: new Set(['id','employee_id','type','start_date','end_date','salary','status','file_url','notes','signed_at','signed_by_name','signature_data','contract_body','created_at']),
  veraluz_schedules: new Set(['id','employee_id','week_start','day_of_week','start_time','end_time','is_off','created_at']),
  veraluz_attendance: new Set(['id','employee_id','date','check_in','check_out','status','notes','created_at']),
  veraluz_payroll: new Set(['id','employee_id','period_month','period_year','base_salary','bonus','deductions','net_salary','paid_at','status','notes','cnps_employee','cnps_employer','irpp','allocations_fam','transport_allow','gross_salary','taxable_income','apply_cnps','apply_irpp','created_at']),
  veraluz_advances: new Set(['id','employee_id','amount','reason','requested_at','approved_at','status','repaid','created_at']),
  veraluz_hr_documents: new Set(['id','employee_id','type','name','file_url','expires_at','created_at']),
  veraluz_hr_tasks: new Set(['id','employee_id','title','description','due_date','priority','status','created_at']),
  veraluz_employee_bonuses: new Set(['id','employee_id','month','type','label','amount','created_at']),
  veraluz_hr_settings: new Set(['id','key','value','updated_at']),
  veraluz_pay_periods: new Set(['id','period_label','start_date','end_date','status','total_gross','total_net','total_cnps_employee','total_cnps_employer','total_irpp','employee_count','created_by','calculated_by','calculated_at','validated_by_manager','validated_by_manager_at','validated_by_owner','validated_by_owner_at','paid_by','paid_at','notes','created_at','updated_at']),
  veraluz_payroll_items: new Set(['id','pay_period_id','employee_id','employee_name_snapshot','role_snapshot','team_snapshot','base_salary','days_worked','hours_worked','overtime_amount','bonus_amount','advance_amount','deduction_amount','transport_allowance','other_allowance','gross_amount','cnps_employee','cnps_employer','irpp','taxable_income','net_amount','status','anomaly_flags','notes','created_at','updated_at']),
  veraluz_employee_checkins: new Set(['id','tenant_id','employee_id','employee_name','role','checkin_type','selfie_url','location_lat','location_lng','device_info','status','reviewed_by','reviewed_at','notes','created_at']),
};

const RH_WRITABLE_SETTINGS = new Set([
  'payday','notify_email','advance_limit_pct','hotel_name','hotel_address',
  'bank_name','bank_account','momo_operator',
]);

type Actor = { id: string; role: string; rawRole: string };
type DbClient = ReturnType<typeof createClient>;
type TargetAccess =
  | { ok: true; target: { id: string; role: string } }
  | { ok: false; status: number; error: string };

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

// AUTH-R5: roleClass replaced by normalizeRole from _rbac.ts

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
      role: normalizeRole(employee.role),
      rawRole: String(employee.role || '').toLowerCase(),
    },
    serverError: false,
  };
}

// AUTH-R5: requireRole removed — use hasCapability(actor.role, cap) directly

function isDeliveryTeamName(value: unknown) {
  return String(value || '').trim().toLowerCase() === 'livreurs';
}

async function getDeliveryEmployee(db: DbClient, actor: Actor) {
  const { data: employee, error: employeeError } = await db
    .from('veraluz_employees')
    .select('id,full_name,role,status,team_id,phone,photo_url,public_display_name,identity_verified')
    .eq('id', actor.id)
    .maybeSingle();
  if (employeeError) {
    console.error('[employees-secure] delivery_employee_lookup_failed code=', employeeError.code);
    return { employee: null, status: 500, error: 'server_error' };
  }
  if (!employee || !ACTIVE_STATUSES.has(String(employee.status || '').toLowerCase()) || !employee.team_id) {
    return { employee: null, status: 403, error: 'delivery_access_forbidden' };
  }
  const { data: team, error: teamError } = await db
    .from('veraluz_teams')
    .select('id,name')
    .eq('id', employee.team_id)
    .maybeSingle();
  if (teamError) {
    console.error('[employees-secure] delivery_team_lookup_failed code=', teamError.code);
    return { employee: null, status: 500, error: 'server_error' };
  }
  if (!team || !isDeliveryTeamName(team.name)) {
    return { employee: null, status: 403, error: 'delivery_access_forbidden' };
  }
  return { employee, status: 200, error: null };
}

// AUTH-R5: isPrivilegedRole/Actor — delegated to _rbac.ts hasCapability('auth.users.manage')

function canAssignRole(actor: Actor, targetRole: string) {
  return hasCapability(actor.role, 'auth.users.manage') || !isPrivilegedRole(targetRole);
}

async function authorizeTargetMutation(
  db: DbClient,
  actor: Actor,
  employeeId: string,
): Promise<TargetAccess> {
  const { data: target, error } = await db
    .from('veraluz_employees')
    .select('id,role')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) {
    console.error('[employees-secure] privileged_target_lookup_failed code=', error.code);
    return { ok: false, status: 500, error: 'server_error' };
  }
  if (!target) return { ok: false, status: 404, error: 'employee_not_found' };
  if (!hasCapability(actor.role, 'auth.users.manage') && isPrivilegedRole(target.role)) {
    return { ok: false, status: 403, error: 'privileged_target_forbidden' };
  }
  return { ok: true, target: { id: String(target.id), role: String(target.role || '') } };
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
  return KNOWN_EMPLOYEE_ROLES.has(normalized) ? normalized : null;
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

function validEmployeePhotoUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    const projectOrigin = new URL(SUPABASE_URL).origin;
    const photoPrefix = '/storage/v1/object/public/employee-photos/';
    if (url.protocol !== 'https:' || url.origin !== projectOrigin) return null;
    if (!url.pathname.startsWith(photoPrefix) || url.pathname.length <= photoPrefix.length) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validEmployeeSelfieUrl(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (!raw || raw.length > 2048) return undefined;
  try {
    const url = new URL(raw);
    const projectOrigin = new URL(SUPABASE_URL).origin;
    const selfiePrefix = '/storage/v1/object/public/employee-selfies/';
    if (url.protocol !== 'https:' || url.origin !== projectOrigin) return undefined;
    if (!url.pathname.startsWith(selfiePrefix) || url.pathname.length <= selfiePrefix.length) return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function targetEmployeeId(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

function rhResourceName(value: unknown) {
  const name = String(value || '').split('?')[0].trim();
  return Object.prototype.hasOwnProperty.call(RH_RESOURCE_FIELDS, name) ? name : null;
}

function sanitizeRhValues(resource: string, value: unknown, actor: Actor) {
  if (!isPlainObject(value)) return null;
  const allowed = RH_RESOURCE_FIELDS[resource];
  if (!allowed || !Object.keys(value).every((key) => allowed.has(key))) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    clean[key] = /(^|_)(created_by|calculated_by|validated_by_manager|validated_by_owner|paid_by|reviewed_by)$/.test(key)
      ? actor.id
      : fieldValue;
  }
  return clean;
}

function doualaClock() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Douala', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}:${read('second')}`,
  };
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
      .select('id,full_name,civility,first_name,last_name,role,phone,email,hire_date,team_id,department,status,photo_url,public_display_name,public_role_label,identity_verified')
      .eq('id', actor.id)
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] get_my_profile_failed code=', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    if (!profile) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, profile }, 200, origin);
  }

  if (action === 'update_my_profile') {
    if (!validateFields(body, UPDATE_MY_PROFILE_FIELDS)) {
      return json({ ok: false, error: 'invalid_profile_fields' }, 400, origin);
    }
    // Build update — only whitelisted fields, reject unknown keys
    const update: Record<string, unknown> = {};
    if ('civility' in body)    update.civility    = optionalText(body.civility, 32);
    if ('first_name' in body)  update.first_name  = optionalText(body.first_name, 80);
    if ('last_name' in body)   update.last_name   = optionalText(body.last_name, 80);
    if ('phone' in body)       update.phone       = optionalText(body.phone, 64);
    if ('email' in body)       update.email       = optionalText(body.email, 254);
    if ('photo_url' in body) {
      const photoUrl = validEmployeePhotoUrl(body.photo_url);
      if (body.photo_url !== null && body.photo_url !== '' && photoUrl === null) {
        return json({ ok: false, error: 'invalid_photo_url' }, 400, origin);
      }
      update.photo_url = photoUrl;
    }
    if (!Object.keys(update).length) {
      return json({ ok: false, error: 'no_profile_fields' }, 400, origin);
    }
    // Recalculate full_name server-side if first or last name changes
    const fn = update.first_name as string | null | undefined;
    const ln = update.last_name  as string | null | undefined;
    if (fn !== undefined || ln !== undefined) {
      // Fetch current values to fill missing side
      const { data: cur } = await db
        .from('veraluz_employees')
        .select('first_name,last_name')
        .eq('id', actor.id)
        .maybeSingle();
      const newFirst = fn !== undefined ? fn : (cur?.first_name || null);
      const newLast  = ln !== undefined ? ln : (cur?.last_name  || null);
      if (newFirst && newLast) {
        update.full_name = newFirst + ' ' + newLast;
      } else if (newFirst) {
        update.full_name = newFirst;
      } else if (newLast) {
        update.full_name = newLast;
      }
    }
    const { data: profile, error } = await db
      .from('veraluz_employees')
      .update(update)
      .eq('id', actor.id)
      .select('id,full_name,civility,first_name,last_name,role,phone,email,hire_date,team_id,department,status,photo_url,public_display_name,public_role_label,identity_verified')
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] update_my_profile_failed code=', error.code);
      return json({ ok: false, error: 'profile_update_failed' }, 500, origin);
    }
    if (!profile) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, profile }, 200, origin);
  }

  if (action === 'get_my_delivery_profile') {
    if (!validateFields(body, GET_MY_DELIVERY_PROFILE_FIELDS)) {
      return json({ ok: false, error: 'invalid_delivery_profile_fields' }, 400, origin);
    }

    const delivery = await getDeliveryEmployee(db, actor);
    if (!delivery.employee) {
      return json({ ok: false, error: delivery.error, delivery_access: false }, delivery.status, origin);
    }
    const employee = delivery.employee;

    const profile = {
      id: employee.id,
      full_name: employee.full_name,
      role: employee.role,
      phone: employee.phone,
      photo_url: employee.photo_url,
      public_display_name: employee.public_display_name,
      identity_verified: employee.identity_verified,
    };
    return json({ ok: true, delivery_access: true, profile }, 200, origin);
  }

  if (action === 'get_my_delivery_shift_status') {
    if (!validateFields(body, GET_MY_DELIVERY_SHIFT_FIELDS)) {
      return json({ ok: false, error: 'invalid_delivery_shift_fields' }, 400, origin);
    }
    const delivery = await getDeliveryEmployee(db, actor);
    if (!delivery.employee) return json({ ok: false, error: delivery.error }, delivery.status, origin);
    const clock = doualaClock();
    const { data: attendance, error } = await db.from('veraluz_attendance')
      .select('id,date,check_in,check_out,status')
      .eq('employee_id', actor.id)
      .eq('date', clock.date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] delivery_shift_lookup_failed code=', error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, shift: attendance || null }, 200, origin);
  }

  if (action === 'record_my_delivery_checkin') {
    if (!validateFields(body, RECORD_MY_DELIVERY_CHECKIN_FIELDS) || body.checkin_type !== 'shift_start') {
      return json({ ok: false, error: 'invalid_delivery_checkin' }, 400, origin);
    }
    const delivery = await getDeliveryEmployee(db, actor);
    if (!delivery.employee) return json({ ok: false, error: delivery.error }, delivery.status, origin);
    const selfieUrl = validEmployeeSelfieUrl(body.selfie_url);
    if (selfieUrl === undefined) return json({ ok: false, error: 'invalid_selfie_url' }, 400, origin);
    const deviceInfo = optionalText(body.device_info, 160);
    const { data: checkin, error } = await db.from('veraluz_employee_checkins').insert({
      id: `checkin-${crypto.randomUUID()}`,
      tenant_id: TENANT_ID,
      employee_id: actor.id,
      employee_name: delivery.employee.full_name,
      role: delivery.employee.role,
      checkin_type: 'shift_start',
      selfie_url: selfieUrl,
      device_info: deviceInfo,
      status: 'pending',
    }).select('id,checkin_type,status,created_at').single();
    if (error) {
      console.error('[employees-secure] delivery_checkin_write_failed code=', error.code);
      return json({ ok: false, error: 'delivery_checkin_write_failed' }, 500, origin);
    }
    return json({ ok: true, checkin }, 200, origin);
  }

  if (action === 'update_my_photo') {
    if (!validateFields(body, UPDATE_MY_PHOTO_FIELDS)) {
      return json({ ok: false, error: 'invalid_photo_fields' }, 400, origin);
    }
    const photoUrl = validEmployeePhotoUrl(body.photo_url);
    if (!photoUrl) return json({ ok: false, error: 'invalid_photo_url' }, 400, origin);

    const { data: profile, error } = await db
      .from('veraluz_employees')
      .update({ photo_url: photoUrl })
      .eq('id', actor.id)
      .select('id,photo_url')
      .maybeSingle();
    if (error) {
      console.error('[employees-secure] update_my_photo_failed code=', error.code);
      return json({ ok: false, error: 'photo_update_failed' }, 500, origin);
    }
    if (!profile) return json({ ok: false, error: 'employee_not_found' }, 404, origin);
    return json({ ok: true, profile }, 200, origin);
  }

  if (action === 'get_my_rh_workspace') {
    if (!validateFields(body, SELF_WORKSPACE_FIELDS)) {
      return json({ ok: false, error: 'invalid_workspace_fields' }, 400, origin);
    }
    const requests = await Promise.all([
      db.from('veraluz_employees').select('id,full_name,civility,first_name,last_name,role,phone,email,hire_date,team_id,department,status,photo_url,public_display_name').eq('id', actor.id).maybeSingle(),
      db.from('veraluz_attendance').select('id,date,check_in,check_out,status').eq('employee_id', actor.id).order('date', { ascending: false }).limit(20),
      db.from('veraluz_hr_tasks').select('id,title,description,due_date,priority,status').eq('employee_id', actor.id).order('due_date', { ascending: true }).limit(20),
      db.from('veraluz_payroll').select('id,period_month,period_year,net_salary,status,paid_at').eq('employee_id', actor.id).order('created_at', { ascending: false }).limit(3),
      db.from('veraluz_schedules').select('id,week_start,day_of_week,start_time,end_time,is_off').eq('employee_id', actor.id).order('week_start', { ascending: false }).limit(21),
      db.from('veraluz_advances').select('id,amount,reason,requested_at,approved_at,status,repaid').eq('employee_id', actor.id).order('requested_at', { ascending: false }).limit(20),
      db.from('veraluz_hr_documents').select('id,type,name,file_url,expires_at,created_at').eq('employee_id', actor.id).order('created_at', { ascending: false }).limit(20),
      db.from('veraluz_contracts').select('id,type,start_date,end_date,status,file_url,signed_at').eq('employee_id', actor.id).order('created_at', { ascending: false }).limit(20),
      db.from('veraluz_employee_bonuses').select('id,month,type,label,amount').eq('employee_id', actor.id).order('month', { ascending: false }).limit(24),
    ]);
    const failed = requests.find((result) => result.error);
    if (failed?.error) {
      console.error('[employees-secure] self_workspace_failed code=', failed.error.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({ ok: true, workspace: {
      profile: requests[0].data,
      attendance: requests[1].data || [],
      tasks: requests[2].data || [],
      payroll: requests[3].data || [],
      schedules: requests[4].data || [],
      advances: requests[5].data || [],
      documents: requests[6].data || [],
      contracts: requests[7].data || [],
      bonuses: requests[8].data || [],
    } }, 200, origin);
  }

  if (action === 'punch_self' || action === 'punch_my_delivery_shift') {
    const allowedFields = action === 'punch_self' ? PUNCH_SELF_FIELDS : PUNCH_MY_DELIVERY_SHIFT_FIELDS;
    if (!validateFields(body, allowedFields) || !['in', 'out'].includes(String(body.event || ''))) {
      return json({ ok: false, error: 'invalid_punch' }, 400, origin);
    }
    if (action === 'punch_my_delivery_shift') {
      const delivery = await getDeliveryEmployee(db, actor);
      if (!delivery.employee) return json({ ok: false, error: delivery.error }, delivery.status, origin);
    }
    const clock = doualaClock();
    const { data: current, error: currentError } = await db
      .from('veraluz_attendance')
      .select('id,employee_id,date,check_in,check_out,status')
      .eq('employee_id', actor.id)
      .eq('date', clock.date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (currentError) {
      console.error('[employees-secure] punch_lookup_failed code=', currentError.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    if (body.event === 'in') {
      if (current?.check_in) return json({ ok: false, error: 'already_checked_in' }, 409, origin);
      const write = current
        ? db.from('veraluz_attendance').update({ check_in: clock.time, status: 'present' }).eq('id', current.id).eq('employee_id', actor.id).select('id,date,check_in,check_out,status').maybeSingle()
        : db.from('veraluz_attendance').insert({ id: `att-${crypto.randomUUID()}`, employee_id: actor.id, date: clock.date, check_in: clock.time, status: 'present' }).select('id,date,check_in,check_out,status').single();
      const { data, error } = await write;
      if (error) {
        console.error('[employees-secure] punch_in_failed code=', error.code);
        return json({ ok: false, error: 'attendance_write_failed' }, 500, origin);
      }
      return json({ ok: true, attendance: data }, 200, origin);
    }
    if (!current?.check_in) return json({ ok: false, error: 'check_in_required' }, 409, origin);
    if (current.check_out) return json({ ok: false, error: 'already_checked_out' }, 409, origin);
    const { data, error } = await db.from('veraluz_attendance')
      .update({ check_out: clock.time })
      .eq('id', current.id).eq('employee_id', actor.id)
      .select('id,date,check_in,check_out,status').maybeSingle();
    if (error) {
      console.error('[employees-secure] punch_out_failed code=', error.code);
      return json({ ok: false, error: 'attendance_write_failed' }, 500, origin);
    }
    return json({ ok: true, attendance: data }, 200, origin);
  }

  if (action === 'complete_my_task') {
    if (!validateFields(body, COMPLETE_MY_TASK_FIELDS)) {
      return json({ ok: false, error: 'invalid_task_fields' }, 400, origin);
    }
    const taskId = targetEmployeeId(body.task_id);
    if (!taskId) return json({ ok: false, error: 'invalid_task_id' }, 400, origin);
    const { data: task, error } = await db.from('veraluz_hr_tasks')
      .update({ status: 'termine' }).eq('id', taskId).eq('employee_id', actor.id)
      .select('id,status').maybeSingle();
    if (error) {
      console.error('[employees-secure] complete_my_task_failed code=', error.code);
      return json({ ok: false, error: 'task_update_failed' }, 500, origin);
    }
    if (!task) return json({ ok: false, error: 'task_not_found' }, 404, origin);
    return json({ ok: true, task }, 200, origin);
  }

  if (action === 'rh_read') {
    if (!hasCapability(actor.role, 'employees.manage')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    if (!validateFields(body, RH_READ_FIELDS)) {
      return json({ ok: false, error: 'invalid_rh_read_fields' }, 400, origin);
    }
    const resource = rhResourceName(body.resource);
    if (!resource) return json({ ok: false, error: 'invalid_rh_resource' }, 400, origin);
    const { data: rows, error } = await db.from(resource).select('*').limit(500);
    if (error) {
      console.error('[employees-secure] rh_read_failed resource=', resource, ' code=', error.code);
      return json({ ok: false, error: 'rh_read_failed' }, 500, origin);
    }
    return json({ ok: true, rows: rows || [] }, 200, origin);
  }

  if (action === 'rh_write') {
    if (!hasCapability(actor.role, 'employees.manage')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    if (!validateFields(body, RH_WRITE_FIELDS)) {
      return json({ ok: false, error: 'invalid_rh_write_fields' }, 400, origin);
    }
    const resource = rhResourceName(body.resource);
    const operation = String(body.operation || '');
    if (!resource || !['insert','update','delete'].includes(operation)) {
      return json({ ok: false, error: 'invalid_rh_write' }, 400, origin);
    }
    const values = operation === 'delete' ? {} : sanitizeRhValues(resource, body.values, actor);
    if (operation !== 'delete' && (!values || !Object.keys(values).length)) {
      return json({ ok: false, error: 'invalid_rh_values' }, 400, origin);
    }
    let query;
    if (operation === 'insert') {
      query = db.from(resource).insert(values!).select('*');
    } else {
      const recordId = targetEmployeeId(body.record_id);
      if (!recordId) return json({ ok: false, error: 'record_id_required' }, 400, origin);
      query = operation === 'update'
        ? db.from(resource).update(values!).eq('id', recordId).select('*')
        : db.from(resource).delete().eq('id', recordId).select('id');
    }
    const { data: rows, error } = await query;
    if (error) {
      console.error('[employees-secure] rh_write_failed resource=', resource, ' operation=', operation, ' code=', error.code);
      return json({ ok: false, error: 'rh_write_failed' }, 500, origin);
    }
    return json({ ok: true, rows: rows || [] }, 200, origin);
  }

  if (action === 'rh_update_settings') {
    if (!hasCapability(actor.role, 'employees.manage')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    if (!validateFields(body, RH_SETTINGS_FIELDS) || !isPlainObject(body.settings)) {
      return json({ ok: false, error: 'invalid_settings_fields' }, 400, origin);
    }
    const entries = Object.entries(body.settings);
    if (!entries.length || !entries.every(([key]) => RH_WRITABLE_SETTINGS.has(key))) {
      return json({ ok: false, error: 'invalid_settings_key' }, 400, origin);
    }
    const updatedAt = new Date().toISOString();
    const results = await Promise.all(entries.map(([key, value]) => db.from('veraluz_hr_settings')
      .update({ value: optionalText(value, 500), updated_at: updatedAt }).eq('key', key).select('key')));
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error('[employees-secure] rh_settings_update_failed code=', failed.error.code);
      return json({ ok: false, error: 'settings_update_failed' }, 500, origin);
    }
    return json({ ok: true, updated: entries.map(([key]) => key) }, 200, origin);
  }

  if (action === 'list_directory') {
    if (!hasCapability(actor.role, 'employees.directory')) {
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
    if (!hasCapability(actor.role, 'restaurant.read')) {
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
    if (!hasCapability(actor.role, 'finance.read')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const [employeeResult, payrollResult] = await Promise.all([
      db.from('veraluz_employees')
        .select('id,full_name,role,status,base_salary,contract_type')
        .order('full_name', { ascending: true }),
      db.from('veraluz_payroll')
        .select('employee_id,period_month,period_year,net_salary')
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false }),
    ]);
    if (employeeResult.error || payrollResult.error) {
      console.error('[employees-secure] list_analytics_failed employee_code=', employeeResult.error?.code,
        ' payroll_code=', payrollResult.error?.code);
      return json({ ok: false, error: 'server_error' }, 500, origin);
    }
    return json({
      ok: true,
      employees: employeeResult.data || [],
      payroll: payrollResult.data || [],
    }, 200, origin);
  }

  if (action === 'rh_list') {
    if (!hasCapability(actor.role, 'employees.manage')) {
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
    if (!hasCapability(actor.role, 'employees.manage')) {
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
    if (!canAssignRole(actor, role)) {
      return json({ ok: false, error: 'privileged_role_forbidden' }, 403, origin);
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
    if (!hasCapability(actor.role, 'employees.manage')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const employeeId = targetEmployeeId(body.employee_id);
    const input = body.employee;
    if (!employeeId || !isPlainObject(input) || !validateFields(input, RH_UPDATE_FIELDS)) {
      return json({ ok: false, error: 'invalid_employee_fields' }, 400, origin);
    }

    const targetAccess = await authorizeTargetMutation(db, actor, employeeId);
    if (!targetAccess.ok) {
      return json({ ok: false, error: targetAccess.error }, targetAccess.status, origin);
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
      if (!canAssignRole(actor, role)) {
        return json({ ok: false, error: 'privileged_role_forbidden' }, 403, origin);
      }
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
      .eq('role', targetAccess.target.role)
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
    if (!hasCapability(actor.role, 'employees.manage')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const employeeId = targetEmployeeId(body.employee_id);
    const status = validStatus(body.status);
    if (!employeeId || !status) return json({ ok: false, error: 'invalid_status' }, 400, origin);

    const targetAccess = await authorizeTargetMutation(db, actor, employeeId);
    if (!targetAccess.ok) {
      return json({ ok: false, error: targetAccess.error }, targetAccess.status, origin);
    }

    const { data: employee, error } = await db
      .from('veraluz_employees')
      .update({ status })
      .eq('id', employeeId)
      .eq('role', targetAccess.target.role)
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
    if (!hasCapability(actor.role, 'employees.manage')) {
      return json({ ok: false, error: 'forbidden' }, 403, origin);
    }
    const employeeId = targetEmployeeId(body.employee_id);
    const baseSalary = validAmount(body.base_salary);
    if (!employeeId || baseSalary === null) {
      return json({ ok: false, error: 'invalid_compensation' }, 400, origin);
    }

    const targetAccess = await authorizeTargetMutation(db, actor, employeeId);
    if (!targetAccess.ok) {
      return json({ ok: false, error: targetAccess.error }, targetAccess.status, origin);
    }

    const { data: employee, error } = await db
      .from('veraluz_employees')
      .update({ base_salary: baseSalary })
      .eq('id', employeeId)
      .eq('role', targetAccess.target.role)
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
