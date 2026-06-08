import { supabase } from "./supabase";
import { getDeviceId } from "./device";
import type {
  ApproachSession,
  BallShot,
  CrossSession,
  PracticeMenu,
  Pro,
  Profile,
  Round,
  Swing,
} from "./types";
// Type-only import: keeps the heavy pose/mediapipe graph (pulled in by
// cross-angle's value imports) out of every bundle that uses db.ts.
import type { CrossResult, CrossFinding } from "./cross-angle";

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

export async function saveBallShot(
  s: Omit<BallShot, "id" | "device_id" | "created_at">,
): Promise<BallShot | null> {
  const { data } = await supabase
    .from("ball_shots")
    .insert({ ...s, device_id: getDeviceId() })
    .select()
    .maybeSingle();
  return (data as BallShot) ?? null;
}

export async function fetchBallShots(limit = 300): Promise<BallShot[]> {
  const { data } = await supabase
    .from("ball_shots")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as BallShot[]) ?? [];
}

// 0-100 stability score + worst finding, derived from the findings alone (no
// runtime dependency on cross-angle, so db.ts stays light).
const SEV_RANK: Record<string, number> = { ok: 0, low: 1, mid: 2, high: 3 };
const SEV_PENALTY: Record<string, number> = { ok: 0, low: 6, mid: 14, high: 28 };

function scoreCross(findings: CrossFinding[]): { score: number; top: CrossFinding | null } {
  if (findings.length === 0) return { score: 0, top: null };
  let penalty = 0;
  let top = findings[0];
  for (const f of findings) {
    penalty += SEV_PENALTY[f.severity] ?? 0;
    if ((SEV_RANK[f.severity] ?? 0) > (SEV_RANK[top.severity] ?? 0)) top = f;
  }
  return { score: Math.max(0, Math.min(100, 100 - penalty)), top };
}

// Persist a two-camera analysis (sync or cross). Derives the score/top-finding
// from the result so callers just hand over the CrossResult.
export async function saveCrossSession(
  result: CrossResult,
  meta: { source: "sync" | "cross"; leftHanded: boolean; heightCm: number },
): Promise<CrossSession | null> {
  if (!result.valid) return null;
  const { score, top } = scoreCross(result.findings);
  const { data } = await supabase
    .from("cross_sessions")
    .insert({
      device_id: getDeviceId(),
      source: meta.source,
      score,
      top_finding: top?.title ?? null,
      top_severity: top?.severity ?? null,
      front_metrics: result.front,
      dtl_metrics: result.dtl,
      findings: result.findings,
      left_handed: meta.leftHanded,
      height_cm: meta.heightCm,
    })
    .select()
    .maybeSingle();
  return (data as CrossSession) ?? null;
}

export async function fetchCrossSessions(limit = 30): Promise<CrossSession[]> {
  const { data } = await supabase
    .from("cross_sessions")
    .select("*")
    .eq("device_id", getDeviceId())
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as CrossSession[]) ?? [];
}

export async function deleteCrossSession(id: string): Promise<void> {
  await supabase.from("cross_sessions").delete().eq("id", id).eq("device_id", getDeviceId());
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
