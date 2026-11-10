import { supabase } from "./supabase.js";

export async function getServices() {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data, error } = await supabase.from("services")
    .select("id,name,description,price,duration_minutes").eq("active", true).order("name");
  if (error) throw error;
  return data;
}
export async function getBarbers() {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data, error } = await supabase.from("barbers")
    .select("id,display_name,specialty").eq("active", true).order("display_name");
  if (error) throw error;
  return data;
}
export async function getAvailableSlots(serviceId, barberId, date) {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_service_id: serviceId, p_barber_id: barberId || null, p_date: date
  });
  if (error) throw error;
  return data;
}
export async function createAppointment(payload) {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Entre na sua conta antes de agendar.");
  const { data, error } = await supabase.functions.invoke("create-appointment", { body: payload });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || "Não foi possível reservar.");
  return data;
}
