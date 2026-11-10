-- DOM NAVALHA — SEGURANÇA E PERMISSÕES
-- Execute depois de schema.sql, no SQL Editor do Supabase.
-- IMPORTANTE: revise os usuários administrativos antes de produção.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$;

CREATE OR REPLACE FUNCTION public.is_barber()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'barber'
  )
$$;

-- Novos usuários sempre começam como clientes.
-- O navegador nunca escolhe o próprio perfil.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), 'Cliente'),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    'client'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_dom_navalha ON auth.users;
CREATE TRIGGER on_auth_user_created_dom_navalha
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Impede alteração do próprio role pelo usuário autenticado.
REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name, phone) ON TABLE public.profiles TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Profiles
DROP POLICY IF EXISTS "profile_read_own_or_admin" ON public.profiles;
CREATE POLICY "profile_read_own_or_admin"
ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profile_update_own" ON public.profiles;
CREATE POLICY "profile_update_own"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- Services: leitura pública somente dos serviços ativos.
DROP POLICY IF EXISTS "services_public_read_active" ON public.services;
CREATE POLICY "services_public_read_active"
ON public.services FOR SELECT TO anon, authenticated
USING (active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "services_admin_all" ON public.services;
CREATE POLICY "services_admin_all"
ON public.services FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Barbers: público vê apenas profissionais ativos.
DROP POLICY IF EXISTS "barbers_public_read_active" ON public.barbers;
CREATE POLICY "barbers_public_read_active"
ON public.barbers FOR SELECT TO anon, authenticated
USING (active = TRUE OR public.is_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "barbers_admin_all" ON public.barbers;
CREATE POLICY "barbers_admin_all"
ON public.barbers FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Horários comerciais são públicos para consulta.
DROP POLICY IF EXISTS "business_hours_read" ON public.business_hours;
CREATE POLICY "business_hours_read"
ON public.business_hours FOR SELECT TO anon, authenticated
USING (TRUE);

DROP POLICY IF EXISTS "business_hours_admin_all" ON public.business_hours;
CREATE POLICY "business_hours_admin_all"
ON public.business_hours FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Escalas: barbeiro vê sua escala; administrador gerencia.
DROP POLICY IF EXISTS "barber_schedules_read" ON public.barber_schedules;
CREATE POLICY "barber_schedules_read"
ON public.barber_schedules FOR SELECT TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.barbers b
    WHERE b.id = barber_id AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "barber_schedules_admin_all" ON public.barber_schedules;
CREATE POLICY "barber_schedules_admin_all"
ON public.barber_schedules FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Ausências: somente administrador e o próprio barbeiro podem consultar.
DROP POLICY IF EXISTS "barber_absences_read" ON public.barber_absences;
CREATE POLICY "barber_absences_read"
ON public.barber_absences FOR SELECT TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.barbers b
    WHERE b.id = barber_id AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "barber_absences_admin_all" ON public.barber_absences;
CREATE POLICY "barber_absences_admin_all"
ON public.barber_absences FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Clientes: cada cliente vê seus dados; barbeiros não recebem lista geral.
DROP POLICY IF EXISTS "clients_read_own_or_admin" ON public.clients;
CREATE POLICY "clients_read_own_or_admin"
ON public.clients FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "clients_update_own_or_admin" ON public.clients;
CREATE POLICY "clients_update_own_or_admin"
ON public.clients FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- Appointments: cliente vê as próprias; barbeiro vê as suas; admin vê todas.
DROP POLICY IF EXISTS "appointments_read_by_role" ON public.appointments;
CREATE POLICY "appointments_read_by_role"
ON public.appointments FOR SELECT TO authenticated
USING (
  public.is_admin()
  OR EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id AND c.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.barbers b
    WHERE b.id = barber_id AND b.user_id = auth.uid()
  )
);

-- Inserção/alteração de reservas ocorre somente pelas funções seguras do servidor.
DROP POLICY IF EXISTS "appointments_no_direct_insert" ON public.appointments;
CREATE POLICY "appointments_no_direct_insert"
ON public.appointments FOR INSERT TO authenticated
WITH CHECK (FALSE);

-- Atualização direta fica limitada à coluna status.
-- Cliente pode cancelar somente a própria reserva pendente e futura.
-- Barbeiro pode marcar como concluído ou ausência somente a própria reserva.
REVOKE UPDATE ON TABLE public.appointments FROM authenticated;
GRANT UPDATE (status) ON TABLE public.appointments TO authenticated;

DROP POLICY IF EXISTS "appointments_admin_update" ON public.appointments;
CREATE POLICY "appointments_admin_update"
ON public.appointments FOR UPDATE TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "appointments_client_cancel" ON public.appointments;
CREATE POLICY "appointments_client_cancel"
ON public.appointments FOR UPDATE TO authenticated
USING (
  status = 'pending'
  AND starts_at > NOW()
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id AND c.user_id = auth.uid()
  )
)
WITH CHECK (
  status = 'cancelled'
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "appointments_barber_update_status" ON public.appointments;
CREATE POLICY "appointments_barber_update_status"
ON public.appointments FOR UPDATE TO authenticated
USING (
  status IN ('pending','confirmed')
  AND EXISTS (
    SELECT 1 FROM public.barbers b
    WHERE b.id = barber_id AND b.user_id = auth.uid()
  )
)
WITH CHECK (
  status IN ('completed','no_show')
  AND EXISTS (
    SELECT 1 FROM public.barbers b
    WHERE b.id = barber_id AND b.user_id = auth.uid()
  )
);

-- Pagamentos: cliente consulta os próprios pagamentos; admin consulta todos.
DROP POLICY IF EXISTS "payments_read_by_owner_or_admin" ON public.payments;
CREATE POLICY "payments_read_by_owner_or_admin"
ON public.payments FOR SELECT TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.id = appointment_id AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "payments_no_client_write" ON public.payments;
CREATE POLICY "payments_no_client_write"
ON public.payments FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Configurações de pagamento não são públicas.
DROP POLICY IF EXISTS "payment_settings_admin_only" ON public.payment_settings;
CREATE POLICY "payment_settings_admin_only"
ON public.payment_settings FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Conceder execução somente às funções públicas de consulta.
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_barber() TO authenticated;

-- Crie o primeiro administrador manualmente depois de cadastrar sua conta:
-- UPDATE public.profiles SET role = 'admin' WHERE id = 'UUID-DO-USUARIO';
-- Execute esse comando apenas no SQL Editor, nunca no frontend.
