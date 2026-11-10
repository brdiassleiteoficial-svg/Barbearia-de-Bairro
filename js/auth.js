import { supabase } from "./supabase.js";

export async function getCurrentUser() {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}
export async function login(email, password) {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
export async function register(email, password, name, phone) {
  if (!supabase) throw new Error("Banco não configurado.");
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: name, phone } }
  });
  if (error) throw error;
  return data;
}
export async function logout() {
  if (!supabase) throw new Error("Banco não configurado.");
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
