-- RECOVERY LOT A — confinement ciblé des données RH et de pointage.
-- Préparé localement uniquement. NE PAS appliquer avant le déploiement de
-- employees-secure + CORE/RH et la levée des dépendances Livreur/Analytics
-- recensées dans RECOVERY_LOT_A_DEPLOY_PLAN.md.

do $$
declare
  target_table text;
  policy_row record;
  protected_tables text[] := array[
    'veraluz_advances',
    'veraluz_attendance',
    'veraluz_contracts',
    'veraluz_employee_bonuses',
    'veraluz_employee_checkins',
    'veraluz_hr_documents',
    'veraluz_hr_settings',
    'veraluz_hr_tasks',
    'veraluz_pay_periods',
    'veraluz_payroll',
    'veraluz_payroll_items',
    'veraluz_pointages',
    'veraluz_schedules'
  ];
begin
  foreach target_table in array protected_tables loop
    if to_regclass('public.' || target_table) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and roles && array['anon', 'authenticated']::name[]
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, target_table);
    end loop;

    execute format('revoke all privileges on table public.%I from anon, authenticated', target_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', target_table);
  end loop;
end
$$;

-- Défense explicite sur les trois tables d'identité/session canoniques.
revoke all privileges on table public.veraluz_employees from anon, authenticated;
revoke all privileges on table public.veraluz_employee_auth_secrets from anon, authenticated;
revoke all privileges on table public.veraluz_employee_sessions from anon, authenticated;
grant select, insert, update, delete on table public.veraluz_employees to service_role;
grant select, insert, update, delete on table public.veraluz_employee_auth_secrets to service_role;
grant select, insert, update, delete on table public.veraluz_employee_sessions to service_role;

notify pgrst, 'reload schema';
