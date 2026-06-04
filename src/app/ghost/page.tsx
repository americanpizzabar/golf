"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { PageHeader, Card, Spinner } from "@/components/ui";
import { drawSkeleton, LM, type Frame } from "@/lib/pose";
import { generateModelSwing } from "@/lib/model-swing";
import {
  EVENT_NAMES,
  EVENT_PHASES,
  detectEvents,
  detectAngle,
  ANGLE_LABEL,
  interpFrame,
  phaseToFrame,
  phaseEventName,
  jointDeviations,
  kinematics,
  sequenceVerdict,
  type JointDeviation,
  type ViewAngle,
} from "@/lib/ghost-sync";
import { fetchSwings, getProfile, fetchPros } from "@/lib/db";
import type { Swing, Pro } from "@/lib/types";

export default function GhostPage() {
  const [swings, setSwings] = useState<Swing[]>([]);
  const [model, setModel] = useState<Swing | null>(null);
  const [leftHanded, setLeftHanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");

  useEffect(() => {
    (async () => {
      const [sw, p, pros] = await Promise.all([fetchSwings(60), getProfile(), fetchPros()]);
      const lh = p?.dominant_hand === "left";
      setLeftHanded(lh);
      const withFrames = sw.filter((s) => s.pose_frames && s.pose_frames.length > 4);
      setSwings(withFrames);
      const pro: Pro | undefined = pros.find((x) => x.name.includes("マキロイ")) ?? pros[0];
      if (pro) {
        let mf = generateModelSwing(pro, 45);
        if (lh) mf = mf.map((f) => f.map((v, i) => (i % 2 === 0 ? 1 - v : v)));
        setModel({
          id: "model",
          device_id: "",
          created_at: new Date().toISOString(),
          score: null,
          sync_rate: null,
          faults: [],
          angles: {},
          thumbnail: null,
          note: null,
          pose_frames: mf,
        } as unknown as Swing);
      }
      if (withFrames.length) setAId(withFrames[0].id);
      setBId("model");
      setLoaded(true);
    })();
  }, []);

  const ghostChoices = [...(model ? [model] : []), ...swings];
  const a = swings.find((s) => s.id === aId);
  const b = ghostChoices.find((s) => s.id === bId);

  // Auto-detect the camera angle from the current swing (with manual override).
  const [angleOverride, setAngleOverride] = useState<ViewAngle | null>(null);
  const autoAngle: ViewAngle = a ? detectAngle(a.pose_frames!) : "front";
  const angle: ViewAngle = angleOverride ?? autoAngle;

  return (
    <main>
      <PageHeader title="ゴースト・フレーム同期" subtitle="8イベントで完全同期・関節ズレを可視化" back />
      <div className="px-4 space-y-4">
        {!loaded ? (
          <Card className="text-center py-8"><Spinner label="読み込み中…" /></Card>
        ) : swings.length < 1 ? (
          <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
            比較には保存済みスイングが必要です。<br />
            <Link href="/swing" style={{ color: "var(--green)" }}>スイング解析</Link>
            を保存すると、お手本モデルと重ねて比較できます。
          </Card>
        ) : (
          <>
            <Card>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs" style={{ color: "var(--cyan)" }}>● 現在（青）</span>
                  <select value={aId} onChange={(e) => setAId(e.target.value)} className="w-full px-2 py-2 mt-1 text-sm">
                    {swings.map((s) => (
                      <option key={s.id} value={s.id}>{label(s)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs" style={{ color: "var(--amber)" }}>● ゴースト（橙）</span>
                  <select value={bId} onChange={(e) => setBId(e.target.value)} className="w-full px-2 py-2 mt-1 text-sm">
                    {ghostChoices.map((s) => (
                      <option key={s.id} value={s.id}>{label(s)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span style={{ color: "var(--muted)" }}>アングル自動判別：</span>
                  <span className="font-bold" style={{ color: "var(--cyan)" }}>{ANGLE_LABEL[angle]}</span>
                  {!angleOverride && <span className="text-[11px] ml-1" style={{ color: "var(--muted)" }}>（自動）</span>}
                </div>
                <div className="flex gap-1">
                  {([["自動", null], ["正面", "front"], ["後方", "dtl"]] as const).map(([lbl, v]) => (
                    <button
                      key={lbl}
                      onClick={() => setAngleOverride(v)}
                      className="px-2 py-1 rounded text-[11px]"
                      style={{
                        background: (angleOverride ?? "auto") === (v ?? "auto") ? "var(--green)" : "var(--bg-soft)",
                        color: (angleOverride ?? "auto") === (v ?? "auto") ? "#03260f" : "var(--muted)",
                      }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
                {angle === "front"
                  ? "正面：頭の上下動（軸の上下ブレ）と腰のスウェー（左右ブレ）をガイド表示します。"
                  : "後方(DTL)：スイングプレーンとお尻の壁（アーリーエクステンション）をガイド表示します。"}
              </div>
            </Card>

            {a && b && (
              <>
                <SyncPlayer
                  key={`${a.id}-${b.id}-${angle}`}
                  a={a.pose_frames!}
                  b={b.pose_frames!}
                  leftHanded={leftHanded}
                  angle={angle}
                />
                <KinematicSequence frames={a.pose_frames!} leftHanded={leftHanded} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function label(s: Swing) {
  if (s.id === "model") return "🏌 お手本モデル（理想スイング）";
  const d = new Date(s.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${d}・${s.sync_rate ?? "—"}%${s.head_speed ? `・${s.head_speed}m/s` : ""}`;
}

// Build a per-swing transform (centre + same body height) for overlay, working
// directly on flat frames and returning a drawable Frame.
function makeTransform(frames: number[][]) {
  const f0 = frames[0];
  const midX = (f0[LM.lHip * 2] + f0[LM.rHip * 2]) / 2;
  const midY = (f0[LM.lHip * 2 + 1] + f0[LM.rHip * 2 + 1]) / 2;
  const ankleY = (f0[LM.lAnkle * 2 + 1] + f0[LM.rAnkle * 2 + 1]) / 2;
  const bodyH = Math.abs(ankleY - f0[LM.nose * 2 + 1]) || 0.5;
  const scale = 0.55 / bodyH;
  return (flat: number[]): Frame => {
    const out: Frame = [];
    for (let i = 0; i < 33; i++) {
      out.push({ x: 0.5 + (flat[i * 2] - midX) * scale, y: 0.62 + (flat[i * 2 + 1] - midY) * scale, z: 0, visibility: 1 });
    }
    return out;
  };
}

const SPEEDS = [
  { label: "x0.25", dur: 6 },
  { label: "x0.5", dur: 3 },
  { label: "x1", dur: 1.5 },
];

function SyncPlayer({ a, b, leftHanded, angle }: { a: number[][]; b: number[][]; leftHanded: boolean; angle: ViewAngle }) {
  const SIZE = 360;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const phaseRef = useRef(0);
  const playingRef = useRef(true);
  const lastUIRef = useRef(0);
  const durRef = useRef(SPEEDS[1].dur);

  const guideRef = useRef("");
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedI, setSpeedI] = useState(1);
  const [alerts, setAlerts] = useState<JointDeviation[]>([]);
  const [guide, setGuide] = useState("");

  const eventsA = useMemo(() => detectEvents(a, leftHanded), [a, leftHanded]);
  const eventsB = useMemo(() => detectEvents(b, leftHanded), [b, leftHanded]);
  const txA = useMemo(() => makeTransform(a), [a]);
  const txB = useMemo(() => makeTransform(b), [b]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    durRef.current = SPEEDS[speedI].dur;
  }, [speedI]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Address-frame reference + lead/trail indices for angle-specific guides.
    const TA0 = txA(a[0]);
    const leadW = leftHanded ? LM.rWrist : LM.lWrist;
    const trailSh = leftHanded ? LM.lShoulder : LM.rShoulder;
    const trailHip = leftHanded ? LM.lHip : LM.rHip;
    const cmPerUnit = 256; // ≈ body-height scale → rough cm (assumes ~170cm)
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (playingRef.current) {
        phaseRef.current += dt / durRef.current;
        if (phaseRef.current >= 1) phaseRef.current = 0;
      }
      const ph = phaseRef.current;
      const fa = interpFrame(a, phaseToFrame(eventsA, ph));
      const fb = interpFrame(b, phaseToFrame(eventsB, ph));
      const TA = txA(fa);
      const TB = txB(fb);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = 0.5;
      drawSkeleton(ctx, TB, SIZE, SIZE, "#f59e0b");
      ctx.globalAlpha = 1;
      drawSkeleton(ctx, TA, SIZE, SIZE, "#22d3ee");

      // Joint-deviation heat-map: flash the joints that differ from the ghost.
      const devs = jointDeviations(fa, fb);
      const flash = 0.5 + 0.5 * Math.sin(now / 110);
      for (const d of devs) {
        const p = TA[d.vertex];
        const x = p.x * SIZE;
        const y = p.y * SIZE;
        ctx.fillStyle = `rgba(244,63,94,${0.25 + 0.4 * flash})`;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(244,63,94,${0.7 + 0.3 * flash})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Angle-specific checkpoint guides.
      ctx.save();
      ctx.lineWidth = 1.5;
      if (angle === "front") {
        const hx = TA0[LM.nose].x * SIZE;
        const hy = TA0[LM.nose].y * SIZE;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(125,211,252,0.5)"; // head reference crosshair
        ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(SIZE, hy); ctx.stroke();
        ctx.strokeStyle = "rgba(34,197,94,0.45)"; // hip-sway rails
        for (const i of [LM.lHip, LM.rHip]) {
          const xx = TA0[i].x * SIZE;
          ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, SIZE); ctx.stroke();
        }
        ctx.setLineDash([]);
        const bob = Math.abs(TA[LM.nose].y - TA0[LM.nose].y);
        const sway = Math.abs((TA[LM.lHip].x + TA[LM.rHip].x) / 2 - (TA0[LM.lHip].x + TA0[LM.rHip].x) / 2);
        const warn = bob > 0.04 || sway > 0.04;
        ctx.fillStyle = warn ? "#f43f5e" : "#7dd3fc";
        ctx.beginPath(); ctx.arc(TA[LM.nose].x * SIZE, TA[LM.nose].y * SIZE, 4, 0, Math.PI * 2); ctx.fill();
        guideRef.current = `頭の上下 ${(bob * cmPerUnit).toFixed(1)}cm ／ 腰スウェー ${(sway * cmPerUnit).toFixed(1)}cm`;
      } else {
        const wx = TA0[leadW].x * SIZE;
        const wy = TA0[leadW].y * SIZE;
        const sx = TA0[trailSh].x * SIZE;
        const sy = TA0[trailSh].y * SIZE;
        let dx = sx - wx;
        let dy = sy - wy;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "rgba(125,211,252,0.55)"; // swing-plane line
        ctx.beginPath(); ctx.moveTo(wx - dx * SIZE, wy - dy * SIZE); ctx.lineTo(sx + dx * SIZE, sy + dy * SIZE); ctx.stroke();
        const wallX = TA0[trailHip].x * SIZE; // early-extension wall
        ctx.strokeStyle = "rgba(34,197,94,0.5)";
        ctx.beginPath(); ctx.moveTo(wallX, 0); ctx.lineTo(wallX, SIZE); ctx.stroke();
        ctx.setLineDash([]);
        const move = Math.abs(TA[trailHip].x - TA0[trailHip].x);
        ctx.fillStyle = move > 0.05 ? "#f43f5e" : "#7dd3fc";
        ctx.beginPath(); ctx.arc(TA[trailHip].x * SIZE, TA[trailHip].y * SIZE, 4, 0, Math.PI * 2); ctx.fill();
        guideRef.current = `お尻の前後動 ${(move * cmPerUnit).toFixed(1)}cm（壁からのズレ）`;
      }
      ctx.restore();

      // Throttle React state updates (~18fps) to keep the UI light.
      if (now - lastUIRef.current > 55) {
        lastUIRef.current = now;
        setPhase(ph);
        setAlerts(devs);
        setGuide(guideRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [a, b, eventsA, eventsB, txA, txB, angle, leftHanded]);

  const seek = (p: number) => {
    phaseRef.current = Math.max(0, Math.min(1, p));
    setPhase(phaseRef.current);
  };
  const stepDelta = 1 / Math.max(8, Math.max(a.length, b.length) - 1);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold" style={{ color: "var(--fg)" }}>
          {phaseEventName(phase)}
        </div>
        <div className="flex gap-1">
          {SPEEDS.map((s, i) => (
            <button
              key={s.label}
              onClick={() => setSpeedI(i)}
              className="px-2 py-0.5 rounded text-[11px]"
              style={{
                background: speedI === i ? "var(--green)" : "var(--bg-soft)",
                color: speedI === i ? "#03260f" : "var(--muted)",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden mx-auto" style={{ background: "#0b1220", border: "1px solid var(--line)", maxWidth: 360 }}>
        <canvas ref={canvasRef} width={SIZE} height={SIZE} className="w-full" />
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => { setPlaying(false); seek(phaseRef.current - stepDelta); }}
          className="btn btn-ghost w-9 h-9 grid place-items-center"
          aria-label="1コマ戻る"
        >
          ◀
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          className="btn btn-ghost w-10 h-9 grid place-items-center text-sm"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          onClick={() => { setPlaying(false); seek(phaseRef.current + stepDelta); }}
          className="btn btn-ghost w-9 h-9 grid place-items-center"
          aria-label="1コマ進む"
        >
          ▶|
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.002}
          value={phase}
          onChange={(e) => { setPlaying(false); seek(Number(e.target.value)); }}
          className="flex-1"
        />
      </div>

      {/* Event jump chips */}
      <div className="grid grid-cols-4 gap-1 mt-2">
        {EVENT_NAMES.map((name, i) => {
          const active = phaseEventName(phase) === name;
          return (
            <button
              key={name}
              onClick={() => { setPlaying(false); seek(EVENT_PHASES[i]); }}
              className="px-1 py-1.5 rounded text-[10px] leading-tight"
              style={{
                background: active ? "var(--cyan)" : "var(--bg-soft)",
                color: active ? "#04121f" : "var(--muted)",
              }}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Angle checkpoint readout */}
      {guide && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: "var(--cyan)", color: "#04121f" }}>
            {angle === "front" ? "正面チェック" : "後方チェック"}
          </span>
          <span style={{ color: "var(--muted)" }}>{guide}</span>
        </div>
      )}

      {/* Heat-map readout */}
      <div className="mt-3">
        <div className="text-[11px] mb-1" style={{ color: "var(--muted)" }}>
          関節ズレ（この局面で お手本 とズレている部位）
        </div>
        {alerts.length === 0 ? (
          <div className="text-xs" style={{ color: "var(--green)" }}>✓ 大きなズレはありません</div>
        ) : (
          <div className="space-y-1">
            {alerts.slice(0, 3).map((d) => (
              <div key={d.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f43f5e" }} />
                  {d.name}
                </span>
                <span style={{ color: "var(--muted)" }}>
                  あなた<span style={{ color: "var(--fg)" }}>{d.you}°</span> / お手本{d.ref}°（差{Math.round(d.diff)}°）
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
        8つの骨格イベントで再生速度を自動同期。スライダーや◀▶で1コマずつ重ね合わせて確認できます。
        ズレ判定は2D骨格からの推定です。
      </p>
    </Card>
  );
}

function KinematicSequence({ frames, leftHanded }: { frames: number[][]; leftHanded: boolean }) {
  const { data, verdict, impactPct } = useMemo(() => {
    const k = kinematics(frames, leftHanded);
    const ev = detectEvents(frames, leftHanded);
    const norm = (arr: number[]) => {
      const mx = Math.max(1e-6, ...arr);
      return arr.map((v) => (v / mx) * 100);
    };
    const np = norm(k.pelvis);
    const nt = norm(k.thorax);
    const na = norm(k.arm);
    const n = k.pelvis.length;
    const d = Array.from({ length: n }, (_, i) => ({
      p: Math.round((i / Math.max(1, n - 1)) * 100),
      pelvis: Math.round(np[i]),
      thorax: Math.round(nt[i]),
      arm: Math.round(na[i]),
    }));
    return {
      data: d,
      verdict: sequenceVerdict(k, ev),
      impactPct: Math.round((ev[5] / Math.max(1, frames.length - 1)) * 100),
    };
  }, [frames, leftHanded]);

  return (
    <Card>
      <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>
        キネマティック・シーケンス（加速の順番）
      </div>
      <div className="text-sm mb-2">
        加速順: <span className="font-bold">{verdict.order.join(" → ")}</span>{" "}
        <span style={{ color: verdict.good ? "var(--green)" : "var(--amber)" }}>
          {verdict.good ? "✓ 効率の良い連鎖" : "腕が先行＝手打ち傾向"}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -22, bottom: 0 }}>
          <XAxis dataKey="p" unit="%" tick={{ fill: "#93a4bf", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#93a4bf", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#16233a", border: "1px solid #243651", borderRadius: 12, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine x={impactPct} stroke="#f43f5e" strokeDasharray="3 3" label={{ value: "IMP", fill: "#f43f5e", fontSize: 10 }} />
          <Line type="monotone" dataKey="pelvis" name="骨盤" stroke="#22c55e" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="thorax" name="胸郭" stroke="#22d3ee" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="arm" name="腕" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
        プロは「骨盤→胸郭→腕」の順にピークが現れます。各線は自分の最大値で正規化したピークタイミングです。
      </p>
    </Card>
  );
}
