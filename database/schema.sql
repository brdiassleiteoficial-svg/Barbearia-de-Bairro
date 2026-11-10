CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','barber','admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.barbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES public.profiles(id),
  display_name TEXT NOT NULL, specialty TEXT, active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  active BOOLEAN DEFAULT TRUE
);
CREATE TABLE public.business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekday INTEGER NOT NULL UNIQUE CHECK (weekday BETWEEN 0 AND 6),
  is_open BOOLEAN NOT NULL DEFAULT FALSE, opening_time TIME, closing_time TIME,
  CHECK ((is_open AND opening_time IS NOT NULL AND closing_time > opening_time) OR NOT is_open)
);
CREATE TABLE public.barber_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES public.barbers(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  is_working BOOLEAN DEFAULT FALSE, start_time TIME, end_time TIME,
  break_start TIME, break_end TIME, UNIQUE(barber_id, weekday)
);
CREATE TABLE public.barber_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id UUID NOT NULL REFERENCES public.barbers(id),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL, reason TEXT,
  CHECK(ends_at > starts_at)
);
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id),
  full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, birthday DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id),
  barber_id UUID NOT NULL REFERENCES public.barbers(id),
  service_id UUID NOT NULL REFERENCES public.services(id),
  starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','completed','cancelled','no_show')),
  created_at TIMESTAMPTZ DEFAULT NOW(), CHECK(ends_at > starts_at)
);
ALTER TABLE public.appointments ADD CONSTRAINT no_overlapping_appointments
EXCLUDE USING gist (barber_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
WHERE (status IN ('pending','confirmed'));
CREATE TABLE public.payment_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_enabled BOOLEAN DEFAULT FALSE,
  deposit_percentage NUMERIC(5,2) CHECK(deposit_percentage BETWEEN 0 AND 100),
  payment_provider TEXT DEFAULT 'undecided' CHECK(payment_provider IN ('undecided','mercadopago','asaas'))
);
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id),
  amount NUMERIC(10,2) NOT NULL CHECK(amount >= 0),
  provider TEXT NOT NULL, provider_payment_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','failed','refunded','expired')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX appointments_barber_date_idx ON public.appointments(barber_id, starts_at);
CREATE INDEX appointments_client_idx ON public.appointments(client_id);
CREATE INDEX appointments_status_idx ON public.appointments(status);
