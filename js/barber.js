// Área do barbeiro: somente os próprios registros são retornados pelo RLS.
import { supabase } from "./supabase.js";

async function requireBarber() {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Faça login.");
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profileError || profile?.role !== "barber") throw new Error("Área exclusiva do barbeiro.");
  const { data: barber, error: barberError } = await supabase
    .from("barbers").select("id,display_name").eq("user_id", user.id).single();
  if (barberError || !barber) throw new Error("Seu cadastro de barbeiro não foi vinculado.");
  return barber;
}

export async function getMyAppointments(fromDate = new Date().toISOString()) {
  const barber = await requireBarber();
  const { data, error } = await supabase
    .from("appointments")
    .select("id,status,starts_at,ends_at,clients(full_name,phone),services(name,duration_minutes,price)")
    .eq("barber_id", barber.id)
    .gte("starts_at", fromDate)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function updateMyAppointmentStatus(id, status) {
  const barber = await requireBarber();
  if (!["completed", "no_show"].includes(status)) {
    throw new Error("O barbeiro só pode marcar atendimento concluído ou ausência.");
  }
  const { data: appointment, error: readError } = await supabase
    .from("appointments").select("id,barber_id,status").eq("id", id).single();
  if (readError) throw readError;
  if (appointment.barber_id !== barber.id) throw new Error("Agendamento não pertence a você.");
  if (!["confirmed", "pending"].includes(appointment.status)) throw new Error("Este agendamento não pode ser alterado.");
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error) throw error;
}

export { requireBarber };
