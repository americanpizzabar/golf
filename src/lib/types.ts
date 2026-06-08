export interface Pro {
  id: string;
  name: string;
  country: string | null;
  height_cm: number;
  arm_span_cm: number;
  shoulder_width_cm: number;
  leg_length_cm: number;
  swing_plane_deg: number;
  tempo_ratio: number;
  spine_tilt_deg: number;
  hip_turn_deg: number;
  shoulder_turn_deg: number;
  style: string | null;
  accent: string;
}

export interface Profile {
  device_id: string;
  nickname: string | null;
  height_cm: number | null;
  arm_length_cm: number | null;
  shoulder_width_cm: number | null;
  leg_length_cm: number | null;
  dominant_hand: string;
  matched_pro_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Fault {
  code: string;
  label: string;
  severity: "low" | "mid" | "high";
  detail: string; // 一言原因
  deg?: number; // 何度ズレ
  cm?: number; // 何センチズレ
}

export interface PhaseAngles {
  shoulderTurn: number;
  hipTurn: number;
  spineTilt: number;
  swingPlane: number;
}

export interface SwingAngles {
  address: PhaseAngles;
  top: PhaseAngles;
  impact: PhaseAngles;
  finish: PhaseAngles;
}

export interface Swing {
  id: string;
  device_id: string;
  created_at: string;
  sync_rate: number | null;
  matched_pro_id: string | null;
  plane_deg: number | null;
  tempo_ratio: number | null;
  spine_tilt_deg: number | null;
  hip_turn_deg: number | null;
  shoulder_turn_deg: number | null;
  faults: Fault[];
  angles: Partial<SwingAngles>;
  thumbnail: string | null;
  note: string | null;
  club?: string | null;
  head_speed?: number | null;
  hand_speed?: number | null;
  efficiency?: number | null;
  apex_m?: number | null;
  pose_frames?: number[][] | null; // compact [x0,y0,...] per downsampled frame
}

export type BallShape = "straight" | "draw" | "fade" | "slice" | "hook";

export interface BallShot {
  id: string;
  device_id: string;
  created_at: string;
  club: string | null;
  shape: BallShape | null;
  apex_m: number | null;
  carry_m: number | null;
  ball_speed: number | null;
  head_speed: number | null;
  smash: number | null;
  curve_px: number | null;
}

export type LieType =
  | "flat"
  | "uphill"
  | "downhill"
  | "toe_up"
  | "toe_down"
  | "rough"
  | "bunker";

// One shot's landing point relative to the pin, in meters.
// dx: +right / -left, dy: +long(奥) / -short(手前).
export interface Shot {
  dx: number;
  dy: number;
  zone: "holed" | "in1" | "in2" | "out";
}

export interface ApproachSession {
  id: string;
  device_id: string;
  created_at: string;
  lie_type: LieType;
  distance_m: number | null;
  attempts: number;
  in_1m: number;
  in_2m: number;
  holed: number;
  shots: Shot[];
}

export interface Drill {
  id: string; // unique identifier (for dedupe / recency)
  cat: string; // category for "max 1 per category per session"
  title: string;
  minutes: number;
  balls?: number;
  desc: string;
  cue: string; // ワンポイント
  videoQuery: string; // for "処方箋" short video suggestion
  tag: string;
}

export interface PracticeMenu {
  id: string;
  device_id: string;
  created_at: string;
  available_min: number | null;
  balls: number | null;
  mode: "range" | "home";
  focus: string[];
  drills: Drill[];
  completed: boolean;
}

export interface RoundPlayer {
  name: string;
  scores: number[]; // per hole
  approachIn: number;
  approachAtt: number;
}

// A saved two-camera (cross-angle / synchronized) analysis. Stores only the
// derived metrics + findings, never the video itself.
export interface CrossSession {
  id: string;
  device_id: string;
  created_at: string;
  source: "sync" | "cross";
  score: number | null;
  top_finding: string | null;
  top_severity: "high" | "mid" | "low" | "ok" | null;
  front_metrics: Record<string, number>;
  dtl_metrics: Record<string, number>;
  findings: import("./cross-angle").CrossFinding[];
  left_handed: boolean;
  height_cm: number | null;
}

export interface Round {
  id: string;
  device_id: string;
  created_at: string;
  course_name: string | null;
  players: RoundPlayer[];
  holes: number;
}
