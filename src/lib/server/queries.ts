import { sql } from "./neon";
import type {
  ApproachSession,
  BallShot,
  CrossSession,
  PracticeMenu,
  Pro,
  Profile,
  Round,
  Swing,
} from "../types";

// All server-side data access for the golf app. Reached only from the /api/db
// route handler. Values interpolated into the sql`` template are bound
// parameters, so these are safe against injection. Rows are scoped by the
// client-supplied device_id, matching the previous (login-free) trust model.

const J = (v: unknown) => JSON.stringify(v);

export async function fetchPros(): Promise<Pro[]> {
  return await sql<Pro>`select * from pros order by height_cm`;
}

export async function getProfile(deviceId: string): Promise<Profile | null> {
  const rows = await sql<Profile>`select * from profiles where device_id = ${deviceId} limit 1`;
  return rows[0] ?? null;
}

export async function upsertProfile(
  deviceId: string,
  p: Partial<Profile>,
): Promise<Profile | null> {
  const rows = await sql<Profile>`
    insert into profiles
      (device_id, nickname, height_cm, arm_length_cm, shoulder_width_cm,
       leg_length_cm, dominant_hand, matched_pro_id, updated_at)
    values
      (${deviceId}, ${p.nickname ?? null}, ${p.height_cm ?? null}, ${p.arm_length_cm ?? null},
       ${p.shoulder_width_cm ?? null}, ${p.leg_length_cm ?? null}, ${p.dominant_hand ?? null},
       ${p.matched_pro_id ?? null}, now())
    on conflict (device_id) do update set
      nickname          = coalesce(excluded.nickname, profiles.nickname),
      height_cm         = coalesce(excluded.height_cm, profiles.height_cm),
      arm_length_cm     = coalesce(excluded.arm_length_cm, profiles.arm_length_cm),
      shoulder_width_cm = coalesce(excluded.shoulder_width_cm, profiles.shoulder_width_cm),
      leg_length_cm     = coalesce(excluded.leg_length_cm, profiles.leg_length_cm),
      dominant_hand     = coalesce(excluded.dominant_hand, profiles.dominant_hand),
      matched_pro_id    = coalesce(excluded.matched_pro_id, profiles.matched_pro_id),
      updated_at        = now()
    returning *`;
  return rows[0] ?? null;
}

export async function saveSwing(
  deviceId: string,
  s: Omit<Swing, "id" | "device_id" | "created_at">,
): Promise<Swing | null> {
  const rows = await sql<Swing>`
    insert into swings
      (device_id, sync_rate, matched_pro_id, plane_deg, tempo_ratio, spine_tilt_deg,
       hip_turn_deg, shoulder_turn_deg, faults, angles, thumbnail, note, club,
       head_speed, hand_speed, efficiency, apex_m, pose_frames)
    values
      (${deviceId}, ${s.sync_rate ?? null}, ${s.matched_pro_id ?? null}, ${s.plane_deg ?? null},
       ${s.tempo_ratio ?? null}, ${s.spine_tilt_deg ?? null}, ${s.hip_turn_deg ?? null},
       ${s.shoulder_turn_deg ?? null}, ${J(s.faults ?? [])}::jsonb, ${J(s.angles ?? {})}::jsonb,
       ${s.thumbnail ?? null}, ${s.note ?? null}, ${s.club ?? null}, ${s.head_speed ?? null},
       ${s.hand_speed ?? null}, ${s.efficiency ?? null}, ${s.apex_m ?? null},
       ${s.pose_frames ? J(s.pose_frames) : null}::jsonb)
    returning *`;
  return rows[0] ?? null;
}

export async function fetchSwings(deviceId: string, limit = 50): Promise<Swing[]> {
  return await sql<Swing>`
    select * from swings where device_id = ${deviceId}
    order by created_at desc limit ${limit}`;
}

export async function saveApproach(
  deviceId: string,
  a: Omit<ApproachSession, "id" | "device_id" | "created_at">,
): Promise<ApproachSession | null> {
  const rows = await sql<ApproachSession>`
    insert into approach_sessions
      (device_id, lie_type, distance_m, attempts, in_1m, in_2m, holed, shots)
    values
      (${deviceId}, ${a.lie_type}, ${a.distance_m ?? null}, ${a.attempts}, ${a.in_1m},
       ${a.in_2m}, ${a.holed}, ${J(a.shots ?? [])}::jsonb)
    returning *`;
  return rows[0] ?? null;
}

export async function fetchApproaches(deviceId: string, limit = 200): Promise<ApproachSession[]> {
  return await sql<ApproachSession>`
    select * from approach_sessions where device_id = ${deviceId}
    order by created_at desc limit ${limit}`;
}

export async function saveMenu(
  deviceId: string,
  m: Omit<PracticeMenu, "id" | "device_id" | "created_at">,
): Promise<PracticeMenu | null> {
  const rows = await sql<PracticeMenu>`
    insert into practice_menus
      (device_id, available_min, balls, mode, focus, drills, completed)
    values
      (${deviceId}, ${m.available_min ?? null}, ${m.balls ?? null}, ${m.mode ?? null},
       ${m.focus ?? []}, ${J(m.drills ?? [])}::jsonb, ${m.completed ?? false})
    returning *`;
  return rows[0] ?? null;
}

export async function fetchMenus(deviceId: string, limit = 20): Promise<PracticeMenu[]> {
  return await sql<PracticeMenu>`
    select * from practice_menus where device_id = ${deviceId}
    order by created_at desc limit ${limit}`;
}

export async function saveBallShot(
  deviceId: string,
  s: Omit<BallShot, "id" | "device_id" | "created_at">,
): Promise<BallShot | null> {
  const rows = await sql<BallShot>`
    insert into ball_shots
      (device_id, club, shape, apex_m, carry_m, ball_speed, head_speed, smash, curve_px)
    values
      (${deviceId}, ${s.club ?? null}, ${s.shape ?? null}, ${s.apex_m ?? null}, ${s.carry_m ?? null},
       ${s.ball_speed ?? null}, ${s.head_speed ?? null}, ${s.smash ?? null}, ${s.curve_px ?? null})
    returning *`;
  return rows[0] ?? null;
}

export async function fetchBallShots(deviceId: string, limit = 300): Promise<BallShot[]> {
  return await sql<BallShot>`
    select * from ball_shots where device_id = ${deviceId}
    order by created_at desc limit ${limit}`;
}

export async function saveRound(
  deviceId: string,
  r: Omit<Round, "id" | "device_id" | "created_at">,
): Promise<Round | null> {
  const rows = await sql<Round>`
    insert into rounds (device_id, course_name, players, holes)
    values (${deviceId}, ${r.course_name ?? null}, ${J(r.players ?? [])}::jsonb, ${r.holes ?? 9})
    returning *`;
  return rows[0] ?? null;
}

export async function fetchRounds(deviceId: string, limit = 20): Promise<Round[]> {
  return await sql<Round>`
    select * from rounds where device_id = ${deviceId}
    order by created_at desc limit ${limit}`;
}

export async function saveCrossSession(
  deviceId: string,
  c: Omit<CrossSession, "id" | "device_id" | "created_at">,
): Promise<CrossSession | null> {
  const rows = await sql<CrossSession>`
    insert into cross_sessions
      (device_id, source, score, top_finding, top_severity, front_metrics, dtl_metrics,
       findings, left_handed, height_cm)
    values
      (${deviceId}, ${c.source}, ${c.score ?? null}, ${c.top_finding ?? null},
       ${c.top_severity ?? null}, ${J(c.front_metrics ?? {})}::jsonb, ${J(c.dtl_metrics ?? {})}::jsonb,
       ${J(c.findings ?? [])}::jsonb, ${c.left_handed ?? false}, ${c.height_cm ?? null})
    returning *`;
  return rows[0] ?? null;
}

export async function fetchCrossSessions(deviceId: string, limit = 30): Promise<CrossSession[]> {
  return await sql<CrossSession>`
    select * from cross_sessions where device_id = ${deviceId}
    order by created_at desc limit ${limit}`;
}

export async function deleteCrossSession(deviceId: string, id: string): Promise<void> {
  await sql`delete from cross_sessions where id = ${id} and device_id = ${deviceId}`;
}
