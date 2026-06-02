import { supabase } from "./supabase";
import { getDeviceId } from "./device";
import type {
  ApproachSession,
  PracticeMenu,
  Pro,
  Profile,
  Round,
  Swing,
} from "./types";

export async function fetchPros(): Promise<Pro[]> {
  const { data } = await supabase.from("pros").select("*").order("height_cm");
  return (data as Pro[]) ?? [];
}

export async function getProfile(): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("device_id", getDeviceId())
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function upsertProfile(p: Partial<Profile>): Promise<Profile | null> {
  const row = { ...p, device_id: getDeviceId(), updated_at: new Date().toISOString() };
  const { data } = await supabase
    .from("profiles")
    .upsert(row, { onConflict: "device_id" })
    .select()
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function saveSwing(
  s: Omit<Swing, "id" | "device_id" | "created_at">,
): Promise<Swing | null> {
  const { data } = await supabase
    .from("swings")
    .insert({ ...s, device_id: getDeviceId() })
    .select()
    .maybeSingle();
  return (data as Swing) ?? null;
}

export async function fetchSwings(limit = 50): Promise<Swing[]> {
  const { data } = await supabase
    .from("swings")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Swing[]) ?? [];
}

export async function saveApproach(
  a: Omit<ApproachSession, "id" | "device_id" | "created_at">,
): Promise<ApproachSession | null> {
  const { data } = await supabase
    .from("approach_sessions")
    .insert({ ...a, device_id: getDeviceId() })
    .select()
    .maybeSingle();
  return (data as ApproachSession) ?? null;
}

export async function fetchApproaches(limit = 200): Promise<ApproachSession[]> {
  const { data } = await supabase
    .from("approach_sessions")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ApproachSession[]) ?? [];
}

export async function saveMenu(
  m: Omit<PracticeMenu, "id" | "device_id" | "created_at">,
): Promise<PracticeMenu | null> {
  const { data } = await supabase
    .from("practice_menus")
    .insert({ ...m, device_id: getDeviceId() })
    .select()
    .maybeSingle();
  return (data as PracticeMenu) ?? null;
}

export async function fetchMenus(limit = 20): Promise<PracticeMenu[]> {
  const { data } = await supabase
    .from("practice_menus")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as PracticeMenu[]) ?? [];
}

export async function saveRound(
  r: Omit<Round, "id" | "device_id" | "created_at">,
): Promise<Round | null> {
  const { data } = await supabase
    .from("rounds")
    .insert({ ...r, device_id: getDeviceId() })
    .select()
    .maybeSingle();
  return (data as Round) ?? null;
}

export async function fetchRounds(limit = 20): Promise<Round[]> {
  const { data } = await supabase
    .from("rounds")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Round[]) ?? [];
}
