-- RECOVERY LOT B — preserve operational occupancy for checked-in overstays.
-- Local migration only: do not apply before the targeted deployment review.

create unique index if not exists veraluz_reservations_one_checkedin_per_unit_idx
  on public.veraluz_reservations (unit_id)
  where unit_id is not null
    and status in ('checkedin', 'checked_in');

create or replace function public.create_booking_hold(
  p_unit_id text,
  p_check_in date,
  p_check_out date,
  p_client_name text,
  p_client_email text default null,
  p_client_phone text default null,
  p_guests integer default 2,
  p_nights integer default 1,
  p_total integer default 0,
  p_notes text default null,
  p_source text default 'booking-engine'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_unit record;
  v_conflict_id text;
  v_rez_id text;
  v_hold_expires timestamptz;
  v_hold_hours integer;
begin
  select coalesce((value->>'hold_duration_hours')::integer, 24)
    into v_hold_hours
    from public.veraluz_settings
   where key = 'booking';

  if v_hold_hours is null or v_hold_hours < 1 then
    v_hold_hours := 24;
  end if;

  if p_check_in is null or p_check_out is null then
    return jsonb_build_object(
      'error', 'invalid_dates',
      'message', 'check_in et check_out sont requis'
    );
  end if;

  if p_check_in >= p_check_out then
    return jsonb_build_object(
      'error', 'invalid_dates',
      'message', 'La date de départ doit être après la date d''arrivée'
    );
  end if;

  if p_check_in < current_date then
    return jsonb_build_object(
      'error', 'invalid_dates',
      'message', 'La date d''arrivée ne peut pas être dans le passé'
    );
  end if;

  if p_client_name is null or trim(p_client_name) = '' then
    return jsonb_build_object(
      'error', 'missing_client',
      'message', 'Le nom du client est requis'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('bkhold_' || p_unit_id)
  );

  select id, status
    into v_unit
    from public.veraluz_units
   where id = p_unit_id
     and status in ('active', 'available');

  if not found then
    return jsonb_build_object(
      'error', 'unit_unavailable',
      'message', 'Cette unité n''est pas disponible à la réservation'
    );
  end if;

  -- A checked-in reservation occupies the unit until a real staff checkout,
  -- independently of its planned check_out date. Other blocking statuses keep
  -- the canonical half-open date overlap rule.
  select id
    into v_conflict_id
    from public.veraluz_reservations
   where unit_id = p_unit_id
     and (
       status in ('checkedin', 'checked_in')
       or (
         check_in < p_check_out
         and check_out > p_check_in
         and (
           status = 'confirmed'
           or (
             status = 'pending'
             and (hold_expires_at is null or hold_expires_at > pg_catalog.now())
           )
         )
       )
     )
   limit 1;

  if v_conflict_id is not null then
    return jsonb_build_object(
      'error', 'availability_conflict',
      'message', 'Cette unité vient de devenir indisponible pour une partie des dates sélectionnées. Veuillez choisir une autre période.'
    );
  end if;

  v_rez_id := 'BK-' || extract(epoch from pg_catalog.now())::bigint::text;
  v_hold_expires := pg_catalog.now() + (v_hold_hours || ' hours')::interval;

  insert into public.veraluz_reservations (
    id, unit_id, client_name, client_email, client_phone,
    guests, nights, total, paid, notes, source,
    check_in, check_out, status, hold_expires_at, created_at
  ) values (
    v_rez_id, p_unit_id, p_client_name, p_client_email, p_client_phone,
    p_guests, p_nights, p_total, 0, p_notes, p_source,
    p_check_in, p_check_out, 'pending', v_hold_expires, pg_catalog.now()
  );

  return jsonb_build_object(
    'id', v_rez_id,
    'status', 'pending',
    'hold_expires_at', v_hold_expires,
    'hold_duration_hours', v_hold_hours,
    'unit_id', p_unit_id,
    'check_in', p_check_in::text,
    'check_out', p_check_out::text,
    'total', p_total,
    'paid', 0
  );
exception
  when exclusion_violation then
    return jsonb_build_object(
      'error', 'availability_conflict',
      'message', 'Cette unité vient de devenir indisponible pour une partie des dates sélectionnées. Veuillez choisir une autre période.'
    );
  when others then
    return jsonb_build_object(
      'error', 'internal_error',
      'message', sqlerrm
    );
end;
$function$;

comment on function public.create_booking_hold(
  text, date, date, text, text, text, integer, integer, integer, text, text
) is 'Creates a serialized public booking hold and blocks units with a checked-in occupant until staff checkout.';

-- A checkout and its canonical housekeeping task must commit together. The
-- Edge Function keeps an idempotent repair path, but this trigger closes the
-- crash window between the reservation UPDATE and a separate task INSERT.
create or replace function public.veraluz_ensure_checkout_housekeeping()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task_id text;
begin
  if new.status <> 'checkedout'
     or old.status is not distinct from new.status then
    return new;
  end if;

  if new.unit_id is null then
    raise exception 'checkout_unit_missing'
      using errcode = '23502';
  end if;

  v_task_id := 'checkout-' || new.id;

  insert into public.veraluz_housekeeping (
    id,
    unit_id,
    type,
    status,
    priority,
    scheduled_for,
    task_label,
    notes,
    reported_by
  ) values (
    v_task_id,
    new.unit_id,
    'cleaning',
    'pending',
    'normal',
    (pg_catalog.clock_timestamp() at time zone 'Africa/Douala')::date,
    'Nettoyage après départ',
    'Checkout réservation ' || new.id,
    'Checkout staff'
  )
  on conflict (id) do nothing;

  -- A duplicate ID is idempotent only when it already represents the exact
  -- canonical task for this reservation and unit.
  if not exists (
    select 1
      from public.veraluz_housekeeping
     where id = v_task_id
       and unit_id = new.unit_id
       and type = 'cleaning'
  ) then
    raise exception 'checkout_effect_conflict'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

revoke execute on function public.veraluz_ensure_checkout_housekeeping()
  from public, anon, authenticated;

drop trigger if exists trg_veraluz_checkout_housekeeping
  on public.veraluz_reservations;

create trigger trg_veraluz_checkout_housekeeping
after update of status on public.veraluz_reservations
for each row
when (
  new.status = 'checkedout'
  and old.status is distinct from new.status
)
execute function public.veraluz_ensure_checkout_housekeeping();

comment on function public.veraluz_ensure_checkout_housekeeping()
is 'Atomically creates the deterministic housekeeping task when a reservation really transitions to checkedout.';
