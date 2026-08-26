-- RECOVERY LOT C — Guest Portal -> Restaurant -> Room Service -> Folio
-- Canonical operational source: public.veraluz_food_orders
-- Canonical financial source: public.veraluz_room_charges
--
-- This migration intentionally does not backfill historical delivered orders.
-- A charge is created only for a new transition to delivered, or by the
-- authenticated server repair RPC.

CREATE UNIQUE INDEX IF NOT EXISTS uix_room_charges_order_original
  ON public.veraluz_room_charges (restaurant_order_id)
  WHERE restaurant_order_id IS NOT NULL
    AND reversal_of_charge_id IS NULL;

CREATE OR REPLACE FUNCTION public.veraluz_create_food_order_room_charge(
  p_order_id uuid,
  p_posted_by text DEFAULT NULL
)
RETURNS TABLE (
  charge_id text,
  amount numeric,
  reservation_id text,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.veraluz_food_orders%ROWTYPE;
  v_reservation public.veraluz_reservations%ROWTYPE;
  v_charge public.veraluz_room_charges%ROWTYPE;
  v_room_name text;
  v_expected_id text;
BEGIN
  SELECT *
    INTO v_order
    FROM public.veraluz_food_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'food_order_not_found';
  END IF;

  IF v_order.source IS DISTINCT FROM 'guest_portal'
     OR v_order.delivery_type IS DISTINCT FROM 'room'
     OR v_order.payment_method IS DISTINCT FROM 'room_charge' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'food_order_not_room_charge';
  END IF;

  SELECT *
    INTO v_charge
    FROM public.veraluz_room_charges
   WHERE restaurant_order_id = v_order.id::text
     AND reversal_of_charge_id IS NULL
   LIMIT 1;

  IF FOUND THEN
    IF v_charge.reservation_id IS DISTINCT FROM v_order.reservation_id
       OR v_charge.unit_id IS DISTINCT FROM v_order.unit_id
       OR v_charge.charge_type IS DISTINCT FROM 'restaurant'
       OR v_charge.amount IS DISTINCT FROM COALESCE(v_order.total, 0)::numeric THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'room_charge_collision';
    END IF;

    RETURN QUERY
      SELECT v_charge.id, v_charge.amount, v_charge.reservation_id, true;
    RETURN;
  END IF;

  IF v_order.status IS DISTINCT FROM 'delivered' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'food_order_not_delivered';
  END IF;

  IF v_order.reservation_id IS NULL OR v_order.unit_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23502', MESSAGE = 'food_order_stay_missing';
  END IF;

  SELECT *
    INTO v_reservation
    FROM public.veraluz_reservations
   WHERE id = v_order.reservation_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'reservation_not_found';
  END IF;

  IF v_reservation.status IS DISTINCT FROM 'checkedin' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'reservation_not_checkedin';
  END IF;

  IF v_reservation.unit_id IS DISTINCT FROM v_order.unit_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'room_charge_unit_mismatch';
  END IF;

  -- Note: veraluz_units has no 'number' column in PROD; use name directly.
  SELECT COALESCE(name, v_order.room_number, v_order.unit_id)
    INTO v_room_name
    FROM public.veraluz_units
   WHERE id = v_order.unit_id
   LIMIT 1;

  v_expected_id := 'food-order-' || v_order.id::text;

  INSERT INTO public.veraluz_room_charges (
    id,
    reservation_id,
    unit_id,
    client_name,
    room_name,
    amount,
    description,
    charge_type,
    restaurant_order_id,
    label,
    posted_by,
    posted_at
  ) VALUES (
    v_expected_id,
    v_order.reservation_id,
    v_order.unit_id,
    v_reservation.client_name,
    v_room_name,
    COALESCE(v_order.total, 0),
    'Room Service #' || COALESCE(v_order.order_number, left(v_order.id::text, 8)),
    'restaurant',
    v_order.id::text,
    'Room Service #' || COALESCE(v_order.order_number, left(v_order.id::text, 8)),
    COALESCE(p_posted_by, v_order.room_service_employee_id, v_order.livreur_id),
    now()
  )
  ON CONFLICT DO NOTHING;

  SELECT *
    INTO v_charge
    FROM public.veraluz_room_charges
   WHERE restaurant_order_id = v_order.id::text
     AND reversal_of_charge_id IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'room_charge_not_guaranteed';
  END IF;

  IF v_charge.reservation_id IS DISTINCT FROM v_order.reservation_id
     OR v_charge.unit_id IS DISTINCT FROM v_order.unit_id
     OR v_charge.charge_type IS DISTINCT FROM 'restaurant'
     OR v_charge.amount IS DISTINCT FROM COALESCE(v_order.total, 0)::numeric THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'room_charge_collision';
  END IF;

  RETURN QUERY
    SELECT v_charge.id, v_charge.amount, v_charge.reservation_id, false;
END;
$$;

REVOKE ALL ON FUNCTION public.veraluz_create_food_order_room_charge(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.veraluz_create_food_order_room_charge(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.veraluz_food_order_room_charge_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.source = 'guest_portal'
     AND NEW.delivery_type = 'room'
     AND NEW.payment_method = 'room_charge'
     AND NEW.status = 'delivered'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'delivered') THEN
    PERFORM public.veraluz_create_food_order_room_charge(
      NEW.id,
      COALESCE(NEW.room_service_employee_id, NEW.livreur_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.veraluz_food_order_room_charge_trigger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_veraluz_food_order_room_charge_insert
  ON public.veraluz_food_orders;
CREATE TRIGGER trg_veraluz_food_order_room_charge_insert
AFTER INSERT ON public.veraluz_food_orders
FOR EACH ROW
EXECUTE FUNCTION public.veraluz_food_order_room_charge_trigger();

DROP TRIGGER IF EXISTS trg_veraluz_food_order_room_charge_update
  ON public.veraluz_food_orders;
CREATE TRIGGER trg_veraluz_food_order_room_charge_update
AFTER UPDATE OF status ON public.veraluz_food_orders
FOR EACH ROW
EXECUTE FUNCTION public.veraluz_food_order_room_charge_trigger();

-- Guest Portal orders are created and mutated only through authenticated Edge
-- Functions. Other legacy Food Lounge orders keep their current public flow
-- until their own recovery lot migrates them.
ALTER TABLE public.veraluz_food_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS food_orders_insert_public ON public.veraluz_food_orders;
CREATE POLICY food_orders_insert_public
  ON public.veraluz_food_orders
  FOR INSERT
  TO anon
  WITH CHECK (
    NOT (
      COALESCE(source, '') = 'guest_portal'
      AND delivery_type = 'room'
    )
  );

DROP POLICY IF EXISTS food_orders_update_anon ON public.veraluz_food_orders;
CREATE POLICY food_orders_update_anon
  ON public.veraluz_food_orders
  FOR UPDATE
  TO anon
  USING (
    NOT (
      COALESCE(source, '') = 'guest_portal'
      AND delivery_type = 'room'
    )
  )
  WITH CHECK (
    NOT (
      COALESCE(source, '') = 'guest_portal'
      AND delivery_type = 'room'
    )
  );

COMMENT ON FUNCTION public.veraluz_create_food_order_room_charge(uuid, text) IS
  'Recovery Lot C: idempotently creates exactly one canonical room charge for a delivered Guest Portal food order.';
COMMENT ON FUNCTION public.veraluz_food_order_room_charge_trigger() IS
  'Recovery Lot C: keeps delivered Guest Portal room orders and folio charges in one PostgreSQL transaction.';
