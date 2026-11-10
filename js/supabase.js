import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env local.
// Em produção, substitua estes valores pelo processo seguro de configuração do hosting.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "SUA_URL_SUPABASE";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "SUA_CHAVE_PUBLICA";

export const supabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("SUA_URL") &&
  SUPABASE_ANON_KEY !== "SUA_CHAVE_PUBLICA" &&
  SUPABASE_ANON_KEY.length > 20;

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;
