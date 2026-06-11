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

// Client-side data layer. All persistence now goes through the /api/db route
// (backed by Neon) instead of talking to a database directly from the browser.
// Function signatures are unchanged so callers (pages/components) are untouched.

type Action =
  | "fetchPros"
  | "getProfile"
  | "upsertProfile"
  | "saveSwing"
  | "fetchSwings"
  | "saveApproach"
  | "fetchApproaches"
  | "saveMenu"
  | "fetchMenus"
  | "saveBallShot"
  | "fetchBallShots"
  | "saveRound"
  | "fetchRounds"
  | "saveCrossSession"
  | "fetchCrossSessions"
  | "deleteCrossSession";

async function api<T>(
  action: Action,
  extra: { data?: unknown; limit?: number; id?: string } = {},
): Promise<T | null> {
  try {
    const res = await fetch("/api/db", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, deviceId: getDeviceId(), ...extra }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T };
    return (json.data ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function fetchPros(): Promise<Pro[]> {
  return (await api<Pro[]>("fetchPros")) ?? [];
}

export async function getProfile(): Promise<Profile | null> {
  return await api<Profile>("getProfile");
}

export async function upsertProfile(p: Partial<Profile>): Promise<Profile | null> {
  return await api<Profile>("upsertProfile", { data: p });
}

export async function saveSwing(
  s: Omit<Swing, "id" | "device_id" | "created_at">,
): Promise<Swing | null> {
  return await api<Swing>("saveSwing", { data: s });
}

export async function fetchSwings(limit = 50): Promise<Swing[]> {
  return (await api<Swing[]>("fetchSwings", { limit })) ?? [];
}

export async function saveApproach(
  a: Omit<ApproachSession, "id" | "device_id" | "created_at">,
): Promise<ApproachSession | null> {
  return await api<ApproachSession>("saveApproach", { data: a });
}

export async function fetchApproaches(limit = 200): Promise<ApproachSession[]> {
  return (await api<ApproachSession[]>("fetchApproaches", { limit })) ?? [];
}

export async function saveMenu(
  m: Omit<PracticeMenu, "id" | "device_id" | "created_at">,
): Promise<PracticeMenu | null> {
  return await api<PracticeMenu>("saveMenu", { data: m });
}

export async function fetchMenus(limit = 20): Promise<PracticeMenu[]> {
  return (await api<PracticeMenu[]>("fetchMenus", { limit })) ?? [];
}

export async function saveBallShot(
  s: Omit<BallShot, "id" | "device_id" | "created_at">,
): Promise<BallShot | null> {
  return await api<BallShot>("saveBallShot", { data: s });
}

export async function fetchBallShots(limit = 300): Promise<BallShot[]> {
  return (await api<BallShot[]>("fetchBallShots", { limit })) ?? [];
}

export async function saveRound(
  r: Omit<Round, "id" | "device_id" | "created_at">,
): Promise<Round | null> {
  return await api<Round>("saveRound", { data: r });
}

export async function fetchRounds(limit = 20): Promise<Round[]> {
  return (await api<Round[]>("fetchRounds", { limit })) ?? [];
}

// 0-100 stability score + worst finding, derived from the findings alone (no
// runtime dependency on cross-angle, so this module stays light).
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
  return await api<CrossSession>("saveCrossSession", {
    data: {
      source: meta.source,
      score,
      top_finding: top?.title ?? null,
      top_severity: top?.severity ?? null,
      front_metrics: result.front,
      dtl_metrics: result.dtl,
      findings: result.findings,
      left_handed: meta.leftHanded,
      height_cm: meta.heightCm,
    },
  });
}

export async function fetchCrossSessions(limit = 30): Promise<CrossSession[]> {
  return (await api<CrossSession[]>("fetchCrossSessions", { limit })) ?? [];
}

export async function deleteCrossSession(id: string): Promise<void> {
  await api("deleteCrossSession", { id });
}
