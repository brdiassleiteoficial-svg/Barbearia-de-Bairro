-- DOM NAVALHA — DISPONIBILIDADE E CRIAÇÃO SEGURA DE RESERVAS
-- Fuso padrão: America/Fortaleza. Ajuste se a barbearia estiver em outro fuso.

CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_service_id UUID,
  p_barber_id UUID DEFAULT NULL,
  p_date DATE DEFAULT CURRENT_DATE,
  p_timezone TEXT DEFAULT 'America/Fortaleza'
)
RETURNS TABLE (
  time TEXT,
  barber_id UUID,
  barber_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration INTEGER;
  v_weekday INTEGER;
  v_open TIME;
  v_close TIME;
  v_now_local TIMESTAMP;
BEGIN
  SELECT duration_minutes INTO v_duration
  FROM public.services
  WHERE id = p_service_id AND active = TRUE;

  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Serviço não encontrado ou inativo.';
  END IF;

  v_weekday := EXTRACT(DOW FROM p_date)::INTEGER;
  v_now_local := NOW() AT TIME ZONE p_timezone;

  SELECT opening_time, closing_time
    INTO v_open, v_close
  FROM public.business_hours
  WHERE weekday = v_weekday AND is_open = TRUE;

  IF v_open IS NULL OR v_close IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT
      b.id AS b_id,
      b.display_name AS b_name,
      gs AS slot_start,
      gs + make_interval(mins => v_duration) AS slot_end,
      sch.start_time,
      sch.end_time,
      sch.break_start,
      sch.break_end
    FROM public.barbers b
    JOIN public.barber_schedules sch ON sch.barber_id = b.id
    CROSS JOIN LATERAL generate_series(
      (p_date + GREATEST(v_open, sch.start_time))::timestamp,
      (p_date + LEAST(v_close, sch.end_time) - make_interval(mins => v_duration))::timestamp,
      INTERVAL '15 minutes'
    ) gs
    WHERE b.active = TRUE
      AND sch.weekday = v_weekday
      AND sch.is_working = TRUE
      AND (p_barber_id IS NULL OR b.id = p_barber_id)
      AND sch.start_time IS NOT NULL
      AND sch.end_time IS NOT NULL
      AND sch.end_time > sch.start_time
  )
  SELECT
    TO_CHAR(c.slot_start, 'HH24:MI') AS time,
    c.b_id,
    c.b_name
  FROM candidate c
  WHERE c.slot_start >= (p_date + v_open)::timestamp
    AND c.slot_end <= (p_date + v_close)::timestamp
    AND (c.break_start IS NULL OR c.break_end IS NULL
      OR NOT (c.slot_start::time < c.break_end AND c.slot_end::time > c.break_start))
    AND (
      p_date > (v_now_local::date)
      OR c.slot_start > v_now_local
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.barber_id = c.b_id
        AND a.status IN ('pending','confirmed')
        AND tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(
              c.slot_start AT TIME ZONE p_timezone,
              c.slot_end AT TIME ZONE p_timezone,
              '[)'
            )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.barber_absences ba
      WHERE ba.barber_id = c.b_id
        AND tstzrange(ba.starts_at, ba.ends_at, '[)') &&
            tstzrange(
              c.slot_start AT TIME ZONE p_timezone,
              c.slot_end AT TIME ZONE p_timezone,
              '[)'
            )
    )
  ORDER BY c.slot_start, c.b_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(UUID, UUID, DATE, TEXT)
TO anon, authenticated;

-- Esta função só pode ser chamada pela Edge Function com service_role.
-- A Edge Function valida o token do usuário e passa o UUID verificado.
CREATE OR REPLACE FUNCTION public.create_appointment_secure(
  p_user_id UUID,
  p_service_id UUID,
  p_barber_id UUID,
  p_date DATE,
  p_time TIME,
  p_name TEXT,
  p_phone TEXT,
  p_email TEXT,
  p_timezone TEXT DEFAULT 'America/Fortaleza'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id UUID;
  v_duration INTEGER;
  v_price NUMERIC(10,2);
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_appointment_id UUID;
  v_barber_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'É necessário entrar na sua conta.';
  END IF;

  IF LENGTH(TRIM(COALESCE(p_name, ''))) < 2
     OR LENGTH(TRIM(COALESCE(p_phone, ''))) < 8 THEN
    RAISE EXCEPTION 'Informe nome e telefone válidos.';
  END IF;

  IF p_date < (NOW() AT TIME ZONE p_timezone)::date THEN
    RAISE EXCEPTION 'Não é possível agendar no passado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND role IN ('client','barber','admin')
  ) THEN
    RAISE EXCEPTION 'Perfil de usuário não encontrado.';
  END IF;

  SELECT duration_minutes, price
    INTO v_duration, v_price
  FROM public.services
  WHERE id = p_service_id AND active = TRUE;

  IF v_duration IS NULL THEN
    RAISE EXCEPTION 'Serviço indisponível.';
  END IF;

  -- O barbeiro informado deve estar ativo e escalado.
  IF p_barber_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.barbers
      WHERE id = p_barber_id AND active = TRUE
    ) THEN
      RAISE EXCEPTION 'Profissional indisponível.';
    END IF;
    v_barber_id := p_barber_id;
  ELSE
    -- Escolhe um profissional com o horário livre.
    SELECT s.barber_id INTO v_barber_id
    FROM public.get_available_slots(
      p_service_id, NULL, p_date, p_timezone
    ) s
    WHERE s.time = TO_CHAR(p_time, 'HH24:MI')
    ORDER BY s.barber_name
    LIMIT 1;
  END IF;

  IF v_barber_id IS NULL THEN
    RAISE EXCEPTION 'Esse horário não está mais disponível.';
  END IF;

  v_start := ((p_date + p_time) AT TIME ZONE p_timezone);
  v_end := v_start + make_interval(mins => v_duration);

  -- Revalida disponibilidade com o profissional escolhido.
  IF NOT EXISTS (
    SELECT 1 FROM public.get_available_slots(
      p_service_id, v_barber_id, p_date, p_timezone
    ) s
    WHERE s.time = TO_CHAR(p_time, 'HH24:MI')
  ) THEN
    RAISE EXCEPTION 'Horário indisponível. Escolha outro.';
  END IF;

  INSERT INTO public.clients (user_id, full_name, phone, email)
  VALUES (p_user_id, TRIM(p_name), TRIM(p_phone), LOWER(TRIM(p_email)))
  ON CONFLICT (user_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (
    client_id, barber_id, service_id, starts_at, ends_at, status
  )
  VALUES (
    v_client_id, v_barber_id, p_service_id, v_start, v_end, 'pending'
  )
  RETURNING id INTO v_appointment_id;

  RETURN jsonb_build_object(
    'appointment_id', v_appointment_id,
    'barber_id', v_barber_id,
    'starts_at', v_start,
    'ends_at', v_end,
    'amount', v_price,
    'status', 'pending'
  );

EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'Esse horário acabou de ser reservado. Escolha outro.';
END;
$$;

REVOKE ALL ON FUNCTION public.create_appointment_secure(
  UUID, UUID, UUID, DATE, TIME, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_appointment_secure(
  UUID, UUID, UUID, DATE, TIME, TEXT, TEXT, TEXT, TEXT
) TO service_role;
