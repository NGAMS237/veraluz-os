/**
 * VERALUZ — Edge Function : verify-employee-pin
 * PROMPT 020C — v4 : accept 4 OR 6 digit PINs + must_change_pin lifecycle
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const ROLE_MAP: Record<string, string> = {
  gerant:'superadmin', directeur:'superadmin', admin:'superadmin', administrateur:'superadmin', superadmin:'superadmin', proprietaire:'superadmin', owner:'superadmin',
  manager:'manager', superviseur:'manager', chef_equipe:'manager',
  receptionniste:'reception', agent_accueil:'reception', reception:'reception', receptioniste:'reception',
  comptable:'accountant', financier:'accountant', finance:'accountant', accountant:'accountant',
  rh:'rh', ressources_humaines:'rh', hr:'rh',
  barman:'restaurant', serveur:'restaurant', restaurant:'restaurant', waiter:'restaurant',
  cuisinier:'kitchen', chef:'kitchen', kitchen:'kitchen', aide_cuisine:'kitchen', cook:'kitchen', cuisine:'kitchen',
  femme_chambre:'housekeeping', agent_menage:'housekeeping', housekeeping:'housekeeping', menage:'housekeeping', cleaner:'housekeeping', housekeeper:'housekeeping',
  technicien:'maintenance', maintenance:'maintenance', plombier:'maintenance', electricien:'maintenance', agent_securite:'maintenance',
  livreur:'delivery', coursier:'delivery', driver:'delivery', delivery:'delivery', chauffeur:'delivery',
  staff:'staff', agent:'staff', employe:'staff',
}

const MODULES_BY_ROLE: Record<string, string[]> = {
  superadmin:   ['reservations','paiements','housekeeping','restaurant','finance','rh','notifications','analytics','audit','settings','eventbus','auth','contacts','appro','integrations'],
  manager:      ['reservations','paiements','housekeeping','restaurant','finance','rh','notifications','analytics','contacts','appro'],
  reception:    ['reservations','paiements','notifications','contacts','housekeeping'],
  rh:           ['rh','notifications','analytics'],
  accountant:   ['finance','paiements','analytics'],
  comptable:    ['finance','paiements','analytics'],
  restaurant:   ['restaurant'], kitchen: ['restaurant'],
  housekeeping: ['housekeeping'], maintenance: ['housekeeping'],
  delivery: [], staff: [],
}

function normalizeRole(raw: string): string {
  const key = (raw || '').toLowerCase().trim().replace(/ /g,'_').replace(/-/g,'_')
  return ROLE_MAP[key] || 'staff'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: { employee_id?: string; pin?: string }
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400) }

  const { employee_id, pin } = body
  if (!employee_id || !pin) return json({ ok: false, error: 'missing_fields' }, 400)

  /* PROMPT 020C — accepter 4 OU 6 chiffres */
  if (!/^\d{4}$/.test(pin) && !/^\d{6}$/.test(pin)) {
    return json({ ok: false, error: 'invalid_credentials' }, 401)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: rows, error } = await supabase
    .from('veraluz_employees')
    .select('id,full_name,role,pin_code,status,team_id,phone,email,hire_date,must_change_pin,temporary_pin_expires_at,failed_pin_attempts,pin_locked_until')
    .eq('id', employee_id).eq('status', 'actif').limit(1)

  if (error || !rows || rows.length === 0) return json({ ok: false, error: 'invalid_credentials' }, 401)

  const emp = rows[0]

  if (emp.pin_locked_until && new Date(emp.pin_locked_until) > new Date()) return json({ ok: false, error: 'too_many_attempts' }, 429)

  const storedPin = String(emp.pin_code || '').trim()
  if (!storedPin || storedPin !== pin) {
    const newAttempts = (emp.failed_pin_attempts || 0) + 1
    const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
    await supabase.from('veraluz_employees').update({ failed_pin_attempts: newAttempts, ...(lockUntil ? { pin_locked_until: lockUntil } : {}) }).eq('id', employee_id)
    return json({ ok: false, error: 'invalid_credentials' }, 401)
  }

  if (emp.must_change_pin && emp.temporary_pin_expires_at && new Date(emp.temporary_pin_expires_at) < new Date()) return json({ ok: false, error: 'pin_expired' }, 401)

  await supabase.from('veraluz_employees').update({ failed_pin_attempts: 0, pin_locked_until: null }).eq('id', employee_id)

  const coreRole = normalizeRole(emp.role || 'staff')
  const now = Date.now()
  const fullName = String(emp.full_name || '').trim() || 'Employé'

  return json({
    ok: true,
    must_change_pin: !!(emp.must_change_pin),
    employee: {
      id: String(emp.id), employee_id: String(emp.id),
      employee_name: fullName, full_name: fullName,
      role: coreRole, raw_role: emp.role || 'staff', team_id: emp.team_id || null,
      allowed_modules: (MODULES_BY_ROLE[coreRole] || []).slice(),
      login_time: new Date(now).toISOString(),
      session_expiry: new Date(now + 12*60*60*1000).toISOString(),
      session_expiry_ts: now + 12*60*60*1000,
    },
  })
})
