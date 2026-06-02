import { createClient } from "@supabase/supabase-js";

// Publishable (anon) key is safe to expose to the browser. Fallbacks keep the
// app working even if env vars are not wired up in a given environment.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://fkxhneopceeblcpidxzb.supabase.co";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_FmW0R3RAp_KeSCjFK4DBVg_HWJ8MMiz";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});
