-- PROMPT 009 — change_token (PIN provisoire) + RPC veraluz_reset_employee_pin
-- Applique a dfdmasejsoibxrvubegu le 2026-08-08 (migration prompt009_auth_change_tokens_and_reset_rpc).
-- Ne touche a aucune colonne/table existante — purement additif.

create table if not exists public.veraluz_employee_change_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null references public.veraluz_employees(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table public.veraluz_employee_change_tokens is
  'PROMPT 009 — jeton a usage unique, duree de vie courte (15 min), emis par verify-employee-pin '
  'quand must_change_pin=true. Accepte UNIQUEMENT par complete-forced-pin-change. Ne remplace pas '
  'veraluz_employee_sessions : un change_token ne peut jamais devenir une session CORE/metier tant '
  'que le changement de PIN n''a pas ete complete avec succes.';

create index if not exists idx_change_tokens_employee on public.veraluz_employee_change_tokens(employee_id);
create index if not exists idx_change_tokens_expires   on public.veraluz_employee_change_tokens(expires_at);

alter table public.veraluz_employee_change_tokens enable row level security;
-- Aucune policy : deny-all pour anon/authenticated. Seules les Edge Functions
-- (service_role) peuvent lire/ecrire cette table, comme pour les autres tables AUTH.

create or replace function public.veraluz_reset_employee_pin(
  p_employee_id text, p_new_pin text, p_reset_by text
) returns jsonb language plpgsql security definer set search_path = 'public', 'extensions'
as $function$
begin
  if p_new_pin is null or p_new_pin !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_pin_format');
  end if;
  if not exists (select 1 from public.veraluz_employees where id = p_employee_id) then
    return jsonb_build_object('ok', false, 'error', 'employee_not_found');
  end if;

  insert into public.veraluz_employee_auth_secrets
    (employee_id, pin_hash, hash_algo, pin_updated_at, migration_status,
     must_change_pin, temporary_pin_expires_at, pin_status, last_reset_at, last_reset_by)
  values (p_employee_id,
          extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)),
          'bcrypt-bf-10', now(), 'migrated',
          true, now() + interval '24 hours', 'active', now(), p_reset_by)
  on conflict (employee_id) do update set
     pin_hash = excluded.pin_hash, hash_algo = 'bcrypt-bf-10',
     pin_updated_at = now(), migration_status = 'migrated',
     must_change_pin = true, temporary_pin_expires_at = now() + interval '24 hours',
     pin_status = 'active', failed_change_count = 0,
     last_reset_at = now(), last_reset_by = p_reset_by;

  update public.veraluz_employees
     set failed_pin_attempts = 0, pin_locked_until = null
   where id = p_employee_id;

  return jsonb_build_object('ok', true);
end
$function$;

comment on function public.veraluz_reset_employee_pin(text, text, text) is
  'PROMPT 009 — reinitialisation securisee d''un PIN employe par la Direction. Genere un PIN '
  'provisoire (fourni par l''appelant, deja genere cote Edge Function via crypto.getRandomValues), '
  'l''ecrit en bcrypt uniquement, force must_change_pin=true (expire 24h), et leve le verrou '
  'anti-brute-force existant. Le PIN en clair n''est jamais stocke ni journalise par cette fonction.';
