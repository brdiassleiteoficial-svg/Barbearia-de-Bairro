// Área do cliente: consulta seus dados e seus próprios agendamentos.
import { supabase } from "./supabase.js";

async function requireClient() {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Entre na sua conta para continuar.");
  return user;
}

export async function getMyProfile() {
  const user = await requireClient();
  const { data, error } = await supabase
    .from("profiles").select("id,full_name,phone,role,created_at")
    .eq("id", user.id).single();
  if (error) throw error;
  return { ...data, email: user.email };
}

export async function updateMyProfile({ full_name, phone }) {
  const user = await requireClient();
  const payload = {
    full_name: String(full_name ?? "").trim().slice(0, 120),
    phone: String(phone ?? "").trim().slice(0, 20),
  };
  if (payload.full_name.length < 2) throw new Error("Informe seu nome.");
  const { error } = await supabase.from("profiles").update(payload).eq("id", user.id);
  if (error) throw error;
  // Mantém a tabela clients sincronizada para o agendamento.
  await supabase.from("clients").update({
    full_name: payload.full_name,
    phone: payload.phone,
  }).eq("user_id", user.id);
}

export async function getMyAppointments() {
  const user = await requireClient();
  const { data: client, error: clientError } = await supabase
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientError) throw clientError;
  if (!client) return [];
  const { data, error } = await supabase
    .from("appointments")
    .select("id,status,starts_at,ends_at,barbers(display_name),services(name,price,duration_minutes),payments(status,amount)")
    .eq("client_id", client.id)
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function cancelMyAppointment(id) {
  const user = await requireClient();
  const { data: client, error: clientError } = await supabase
    .from("clients").select("id").eq("user_id", user.id).single();
  if (clientError) throw clientError;
  const { data: appointment, error: readError } = await supabase
    .from("appointments").select("id,client_id,status,starts_at")
    .eq("id", id).eq("client_id", client.id).single();
  if (readError) throw readError;
  if (appointment.status !== "pending" || new Date(appointment.starts_at) <= new Date()) {
    throw new Error("Somente reservas pendentes futuras podem ser canceladas pelo aplicativo.");
  }
  const { error } = await supabase.from("appointments")
    .update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export { requireClient };
