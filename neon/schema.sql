-- ============================================================================
-- Golf app schema for Neon (Postgres).
--
-- Run this ONCE against your Neon database (via the Neon SQL Editor, psql, or
-- `psql "$DATABASE_URL" -f neon/schema.sql`). It is idempotent.
--
-- Unlike the previous Supabase setup there is no Row Level Security: Neon is
-- reached only from server-side API routes (never the browser), and rows are
-- scoped by the client-supplied device_id exactly as before.
-- ============================================================================

-- Reference data: archetypal pro swings used for the "matched pro" comparison.
create table if not exists pros (
  id                text primary key,
  name              text not null,
  country           text,
  height_cm         numeric not null,
  arm_span_cm       numeric not null,
  shoulder_width_cm numeric not null,
  leg_length_cm     numeric not null,
  swing_plane_deg   numeric not null,
  tempo_ratio       numeric not null,
  spine_tilt_deg    numeric not null,
  hip_turn_deg      numeric not null,
  shoulder_turn_deg numeric not null,
  style             text,
  accent            text default '#16a34a'
);

create table if not exists profiles (
  device_id         text primary key,
  nickname          text,
  height_cm         numeric,
  arm_length_cm     numeric,
  shoulder_width_cm numeric,
  leg_length_cm     numeric,
  dominant_hand     text default 'right',
  matched_pro_id    text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists swings (
  id                uuid primary key default gen_random_uuid(),
  device_id         text not null,
  created_at        timestamptz default now(),
  sync_rate         numeric,
  matched_pro_id    text,
  plane_deg         numeric,
  tempo_ratio       numeric,
  spine_tilt_deg    numeric,
  hip_turn_deg      numeric,
  shoulder_turn_deg numeric,
  faults            jsonb default '[]'::jsonb,
  angles            jsonb default '{}'::jsonb,
  thumbnail         text,
  note              text,
  club              text,
  head_speed        numeric,
  hand_speed        numeric,
  efficiency        numeric,
  apex_m            numeric,
  pose_frames       jsonb
);
create index if not exists swings_device_created on swings (device_id, created_at desc);

create table if not exists approach_sessions (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null,
  created_at  timestamptz default now(),
  lie_type    text not null,
  distance_m  numeric,
  attempts    integer not null default 0,
  in_1m       integer not null default 0,
  in_2m       integer not null default 0,
  holed       integer not null default 0,
  shots       jsonb not null default '[]'::jsonb
);
create index if not exists approach_device_created on approach_sessions (device_id, created_at desc);

create table if not exists practice_menus (
  id            uuid primary key default gen_random_uuid(),
  device_id     text not null,
  created_at    timestamptz default now(),
  available_min integer,
  balls         integer,
  mode          text,
  focus         text[],
  drills        jsonb default '[]'::jsonb,
  completed     boolean default false
);
create index if not exists menus_device_created on practice_menus (device_id, created_at desc);

create table if not exists ball_shots (
  id         uuid primary key default gen_random_uuid(),
  device_id  text not null,
  created_at timestamptz default now(),
  club       text,
  shape      text,
  apex_m     numeric,
  carry_m    numeric,
  ball_speed numeric,
  head_speed numeric,
  smash      numeric,
  curve_px   numeric
);
create index if not exists ball_shots_device_created on ball_shots (device_id, created_at desc);

create table if not exists rounds (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null,
  created_at  timestamptz default now(),
  course_name text,
  players     jsonb default '[]'::jsonb,
  holes       integer default 9
);
create index if not exists rounds_device_created on rounds (device_id, created_at desc);

create table if not exists cross_sessions (
  id            uuid primary key default gen_random_uuid(),
  device_id     text not null,
  created_at    timestamptz not null default now(),
  source        text not null default 'sync',
  score         integer,
  top_finding   text,
  top_severity  text,
  front_metrics jsonb not null default '{}'::jsonb,
  dtl_metrics   jsonb not null default '{}'::jsonb,
  findings      jsonb not null default '[]'::jsonb,
  left_handed   boolean not null default false,
  height_cm     integer
);
create index if not exists cross_sessions_device_created on cross_sessions (device_id, created_at desc);

-- Signaling / control relay for 2-device synchronized recording (/sync).
-- Replaces Supabase Realtime: clients append messages and poll for new ones.
-- Rows are short-lived and swept opportunistically by the API route.
create table if not exists sync_messages (
  seq        bigint generated always as identity primary key,
  code       text not null,
  sender     text not null,
  kind       text not null,           -- 'sig' | 'ctrl'
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists sync_messages_code_seq on sync_messages (code, seq);
create index if not exists sync_messages_created on sync_messages (created_at);

-- Seed / refresh the pro archetypes.
insert into pros (id, name, country, height_cm, arm_span_cm, shoulder_width_cm, leg_length_cm,
                  swing_plane_deg, tempo_ratio, spine_tilt_deg, hip_turn_deg, shoulder_turn_deg, style, accent)
values
  ('pro_compact',      'C. コンパクト型',     'KOR', 168, 168, 42, 84, 64, 2.8, 30, 46, 88,  'コンパクト＆正確（小柄）',       '#3b82f6'),
  ('pro_smooth_tempo', 'S. スムーステンポ型', 'JPN', 175, 176, 44, 90, 61, 3.2, 34, 48, 92,  'リズム重視（オールラウンド）',   '#16a34a'),
  ('pro_classic',      'K. クラシック型',     'GBR', 178, 180, 45, 92, 62, 3.4, 33, 50, 90,  'クラシックスイング（教科書）',   '#8b5cf6'),
  ('pro_flat_athlete', 'A. アスリート型',     'AUS', 182, 188, 47, 95, 55, 2.9, 40, 55, 100, 'フラットプレーン（アスリート）', '#f59e0b'),
  ('pro_tall_power',   'T. ロングドライブ型', 'USA', 188, 193, 48, 98, 58, 3.0, 38, 52, 98,  'パワーヒッター（長身・縦振り）', '#ef4444')
on conflict (id) do update set
  name = excluded.name, country = excluded.country, height_cm = excluded.height_cm,
  arm_span_cm = excluded.arm_span_cm, shoulder_width_cm = excluded.shoulder_width_cm,
  leg_length_cm = excluded.leg_length_cm, swing_plane_deg = excluded.swing_plane_deg,
  tempo_ratio = excluded.tempo_ratio, spine_tilt_deg = excluded.spine_tilt_deg,
  hip_turn_deg = excluded.hip_turn_deg, shoulder_turn_deg = excluded.shoulder_turn_deg,
  style = excluded.style, accent = excluded.accent;
