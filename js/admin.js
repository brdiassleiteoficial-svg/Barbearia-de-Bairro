// Painel administrativo Dom Navalha.
// Importe este módulo somente em uma página protegida do administrador.
import { supabase } from "./supabase.js";

async function requireAdmin() {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Faça login.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profileError || profile?.role !== "admin") throw new Error("Acesso restrito ao administrador.");
  return user;
}

export async function getAdminDashboard() {
  await requireAdmin();
  const [appointments, services, barbers, payments] = await Promise.all([
    supabase.from("appointments").select("id,status,starts_at,ends_at,clients(full_name,phone),barbers(display_name),services(name,price)").order("starts_at", { ascending: false }).limit(100),
    supabase.from("services").select("*").order("name"),
    supabase.from("barbers").select("*").order("display_name"),
    supabase.from("payments").select("id,amount,status,provider,created_at").order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [appointments, services, barbers, payments]) {
    if (result.error) throw result.error;
  }
  return {
    appointments: appointments.data,
    services: services.data,
    barbers: barbers.data,
    payments: payments.data,
  };
}

export async function saveService(service) {
  await requireAdmin();
  const payload = {
    name: String(service.name).trim(),
    description: String(service.description ?? "").trim(),
    price: Number(service.price),
    duration_minutes: Number(service.duration_minutes),
    active: service.active !== false,
  };
  if (!payload.name || !Number.isFinite(payload.price) || payload.price < 0 ||
      !Number.isInteger(payload.duration_minutes) || payload.duration_minutes < 1) {
    throw new Error("Confira nome, preço e duração do serviço.");
  }
  const query = service.id
    ? supabase.from("services").update(payload).eq("id", service.id)
    : supabase.from("services").insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export async function saveBarber(barber) {
  await requireAdmin();
  const payload = {
    display_name: String(barber.display_name).trim(),
    specialty: String(barber.specialty ?? "").trim(),
    active: barber.active !== false,
    user_id: barber.user_id || null,
  };
  if (!payload.display_name) throw new Error("Informe o nome do profissional.");
  const query = barber.id
    ? supabase.from("barbers").update(payload).eq("id", barber.id)
    : supabase.from("barbers").insert(payload);
  const { error } = await query;
  if (error) throw error;
}

export async function updateAppointmentStatus(id, status) {
  await requireAdmin();
  const allowed = ["pending", "confirmed", "completed", "cancelled", "no_show"];
  if (!allowed.includes(status)) throw new Error("Status inválido.");
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function saveBusinessHours(rows) {
  await requireAdmin();
  for (const row of rows) {
    const { error } = await supabase.from("business_hours").upsert({
      weekday: Number(row.weekday),
      is_open: Boolean(row.is_open),
      opening_time: row.is_open ? row.opening_time : null,
      closing_time: row.is_open ? row.closing_time : null,
    }, { onConflict: "weekday" });
    if (error) throw error;
  }
}

export async function saveBarberSchedule(rows) {
  await requireAdmin();
  for (const row of rows) {
    const { error } = await supabase.from("barber_schedules").upsert({
      barber_id: row.barber_id,
      weekday: Number(row.weekday),
      is_working: Boolean(row.is_working),
      start_time: row.is_working ? row.start_time : null,
      end_time: row.is_working ? row.end_time : null,
      break_start: row.is_working ? (row.break_start || null) : null,
      break_end: row.is_working ? (row.break_end || null) : null,
    }, { onConflict: "barber_id,weekday" });
    if (error) throw error;
  }
}

export { requireAdmin };
