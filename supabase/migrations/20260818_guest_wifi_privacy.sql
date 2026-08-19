-- GUEST-4A.P1 — wifi credentials are server-only.
-- Public settings remain readable except admin, email and wifi.

drop policy if exists veraluz_settings_anon_read on public.veraluz_settings;
create policy veraluz_settings_anon_read
on public.veraluz_settings
for select
to anon
using (key <> all (array['admin'::text, 'email'::text, 'wifi'::text]));

drop policy if exists veraluz_settings_auth_read on public.veraluz_settings;
create policy veraluz_settings_auth_read
on public.veraluz_settings
for select
to authenticated
using (key <> 'wifi'::text);
