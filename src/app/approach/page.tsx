"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from "recharts";
import { PageHeader, Card, Stat } from "@/components/ui";
import { LIE_LABELS, LIE_ORDER, dispersionStats } from "@/lib/golf";
import { fetchApproaches, saveApproach } from "@/lib/db";
import type { ApproachSession, LieType, Shot } from "@/lib/types";

// Top-down target geometry shared by the recorder and the dispersion map.
const SVG = 300;
const C = SVG / 2;
const PX_PER_M = 30; // 1m = 30px → 4m ≈ 120px (fits)
const MAX_M = 4;

function metersToPx(dx: number, dy: number) {
  return { x: C + dx * PX_PER_M, y: C - dy * PX_PER_M };
}
function pxToMeters(px: number, py: number) {
  const dx = (px - C) / PX_PER_M;
  const dy = -(py - C) / PX_PER_M;
  return { dx, dy };
}
function zoneOf(dx: number, dy: number): Shot["zone"] {
  const d = Math.hypot(dx, dy);
  if (d <= 1) return "in1";
  if (d <= 2) return "in2";
  return "out";
}
const ZONE_COLOR: Record<Shot["zone"], string> = {
  holed: "#fbbf24",
  in1: "#22c55e",
  in2: "#f59e0b",
  out: "#ef4444",
};

export default function ApproachPage() {
  const [tab, setTab] = useState<"record" | "data">("record");
  const [sessions, setSessions] = useState<ApproachSession[]>([]);

  const reload = useCallback(async () => {
    setSessions(await fetchApproaches(300));
  }, []);
  useEffect(() => {
    (async () => setSessions(await fetchApproaches(300)))();
  }, []);

  return (
    <main>
      <PageHeader title="アプローチ計測" subtitle="ARターゲットで寄せ率と散らばりをデータ化" back />

      <div className="px-4">
        <div className="flex gap-2 mb-4">
          {(["record", "data"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="btn flex-1 py-2.5 text-sm"
              style={{
                background: tab === t ? "var(--green)" : "var(--card)",
                color: tab === t ? "#03260f" : "var(--fg)",
                border: "1px solid var(--line)",
              }}
            >
              {t === "record" ? "🎯 計測する" : "📊 データを見る"}
            </button>
          ))}
        </div>

        {tab === "record" ? (
          <Recorder onSaved={() => { reload(); setTab("data"); }} />
        ) : (
          <DataView sessions={sessions} />
        )}
      </div>
    </main>
  );
}

function Recorder({ onSaved }: { onSaved: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const diffCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevFrameRef = useRef<ImageData | null>(null);
  const rafRef = useRef(0);
  const lastShotMsRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const [camOn, setCamOn] = useState(false);
  const [autoBall, setAutoBall] = useState(false);
  const [detectFlash, setDetectFlash] = useState(false);
  const [lie, setLie] = useState<LieType>("flat");
  const [distance, setDistance] = useState("20");
  const [shots, setShots] = useState<Shot[]>([]);
  const autoBallRef = useRef(false);
  useEffect(() => {
    autoBallRef.current = autoBall;
  }, [autoBall]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(rafRef.current);
  }, []);

  async function toggleCam() {
    if (camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setCamOn(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。");
      return;
    }
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        alert("カメラを起動できませんでした。権限を確認してください。");
        return;
      }
    }
    streamRef.current = s;
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.playsInline = true;
      await videoRef.current.play().catch(() => {});
    }
    setCamOn(true);
    if (!diffCanvasRef.current) {
      diffCanvasRef.current = document.createElement("canvas");
      diffCanvasRef.current.width = 64;
      diffCanvasRef.current.height = 48;
    }
    prevFrameRef.current = null;
    rafRef.current = requestAnimationFrame(diffLoop);
  }

  // 背景差分（フレーム間差分）でショット（速い動き）を検知する簡易CV。β。
  // rAF が渡すタイムスタンプを使い、純粋でない performance.now() を避ける。
  function diffLoop(now: number) {
    const video = videoRef.current;
    const cv = diffCanvasRef.current;
    if (video && cv && video.readyState >= 2 && autoBallRef.current) {
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, cv.width, cv.height);
        const cur = ctx.getImageData(0, 0, cv.width, cv.height);
        const prev = prevFrameRef.current;
        if (prev) {
          let diff = 0;
          for (let i = 0; i < cur.data.length; i += 4) {
            diff += Math.abs(cur.data[i] - prev.data[i]);
          }
          const mean = diff / (cur.data.length / 4);
          if (mean > 22 && now - lastShotMsRef.current > 1200) {
            lastShotMsRef.current = now;
            if (navigator.vibrate) navigator.vibrate(25);
            setDetectFlash(true);
            setTimeout(() => setDetectFlash(false), 1200);
          }
        }
        prevFrameRef.current = cur;
      }
    }
    rafRef.current = requestAnimationFrame(diffLoop);
  }

  function onTargetTap(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SVG;
    const py = ((e.clientY - rect.top) / rect.height) * SVG;
    const { dx, dy } = pxToMeters(px, py);
    if (Math.hypot(dx, dy) > MAX_M + 0.5) return;
    const shot: Shot = { dx: round1(dx), dy: round1(dy), zone: zoneOf(dx, dy) };
    setShots((s) => [...s, shot]);
    if (navigator.vibrate) navigator.vibrate(shot.zone === "out" ? 30 : 12);
  }

  function recordHoled() {
    setShots((s) => [...s, { dx: 0, dy: 0, zone: "holed" }]);
    if (navigator.vibrate) navigator.vibrate([10, 40, 10]);
  }
  function undo() {
    setShots((s) => s.slice(0, -1));
  }

  const tally = {
    attempts: shots.length,
    holed: shots.filter((s) => s.zone === "holed").length,
    in_1m: shots.filter((s) => s.zone === "holed" || s.zone === "in1").length,
    in_2m: shots.filter((s) => s.zone !== "out").length,
  };
  const rate1 = tally.attempts ? Math.round((tally.in_1m / tally.attempts) * 100) : 0;

  async function save() {
    if (!tally.attempts) return;
    await saveApproach({
      lie_type: lie,
      distance_m: Number(distance) || null,
      attempts: tally.attempts,
      in_1m: tally.in_1m,
      in_2m: tally.in_2m,
      holed: tally.holed,
      shots,
    });
    setShots([]);
    onSaved();
  }

  return (
    <div className="space-y-4">
      {/* AR target — tap where the ball stopped */}
      <Card className="p-0 overflow-hidden">
        <div className="relative aspect-square" style={{ background: "#0a2417" }}>
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: camOn ? "block" : "none" }}
          />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG} ${SVG}`}
            className="absolute inset-0 w-full h-full touch-none"
            onClick={onTargetTap}
          >
            {!camOn && <rect width={SVG} height={SVG} fill="#0c3a24" />}
            {/* rings */}
            <circle cx={C} cy={C} r={2 * PX_PER_M} fill="#f59e0b18" stroke="#f59e0b" strokeWidth="2" strokeDasharray="7 5" />
            <circle cx={C} cy={C} r={1 * PX_PER_M} fill="#22c55e22" stroke="#22c55e" strokeWidth="2.5" />
            <text x={C} y={C - 2 * PX_PER_M - 6} textAnchor="middle" fill="#f59e0b" fontSize="12" fontWeight="bold">2m</text>
            <text x={C + 1 * PX_PER_M + 12} y={C + 4} fill="#22c55e" fontSize="12" fontWeight="bold">1m</text>
            {/* pin */}
            <line x1={C} y1={C} x2={C} y2={C - 34} stroke="#fff" strokeWidth="2" />
            <circle cx={C} cy={C - 34} r="5" fill="#ef4444" />
            <circle cx={C} cy={C} r="4" fill="#fff" />
            {/* placed shots */}
            {shots.map((s, i) => {
              const p = metersToPx(s.dx, s.dy);
              return <circle key={i} cx={p.x} cy={p.y} r="5.5" fill={ZONE_COLOR[s.zone]} stroke="#0a2417" strokeWidth="1.5" />;
            })}
          </svg>

          {detectFlash && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: "var(--red)", color: "#fff" }}>
              ● ショット検知 — 着弾点をタップ
            </div>
          )}

          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] px-2.5 py-1 rounded-full"
            style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}>
            ボールが止まった位置をタップ
          </div>

          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
            <button onClick={toggleCam} className="btn btn-ghost text-xs px-3 py-1.5">
              {camOn ? "カメラOFF" : "📷 グリーンに重ねる"}
            </button>
            {camOn && (
              <button
                onClick={() => setAutoBall((v) => !v)}
                className="btn text-xs px-3 py-1.5"
                style={{
                  background: autoBall ? "var(--green)" : "var(--card)",
                  color: autoBall ? "#03260f" : "var(--fg)",
                  border: "1px solid var(--line)",
                }}
              >
                🎯 自動検知β {autoBall ? "ON" : "OFF"}
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Lie + distance */}
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>ライの状況</span>
            <select value={lie} onChange={(e) => setLie(e.target.value as LieType)} className="w-full px-3 py-2.5 mt-1">
              {LIE_ORDER.map((l) => (
                <option key={l} value={l}>{LIE_LABELS[l]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>距離 (m)</span>
            <input type="number" inputMode="numeric" value={distance} onChange={(e) => setDistance(e.target.value)} className="w-full px-3 py-2.5 mt-1" />
          </label>
        </div>
      </Card>

      {/* Tally */}
      <div className="grid grid-cols-4 gap-2">
        <Stat label="打数" value={tally.attempts} accent="var(--fg)" />
        <Stat label="1m以内" value={tally.in_1m} accent="var(--green)" />
        <Stat label="成功率" value={rate1} unit="%" accent="var(--cyan)" />
        <Stat label="カップイン" value={tally.holed} accent="#fbbf24" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={recordHoled} className="btn py-3.5 font-bold" style={{ background: "#fbbf24", color: "#3b2600" }}>
          🏆 カップイン
        </button>
        <button onClick={undo} disabled={!shots.length} className="btn btn-ghost py-3.5 disabled:opacity-40">
          ↩ 1球取り消し
        </button>
      </div>

      <button onClick={save} disabled={!tally.attempts} className="btn btn-primary w-full py-3.5 disabled:opacity-40">
        このセッションを保存（{tally.attempts}球）
      </button>

      <p className="text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
        ※ 標準カメラでの高速ボールの弾道自動計測（背景差分・パーティクルフィルタ）は撮影フレームレートの限界があるため、着弾点はタップで記録する方式を採用しています。「自動検知β」はショットの瞬間（速い動き）を検知して記録を促す補助機能です。
      </p>
    </div>
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function DataView({ sessions }: { sessions: ApproachSession[] }) {
  const [lieFilter, setLieFilter] = useState<LieType | "all">("all");

  const byLie = LIE_ORDER.map((l) => {
    const s = sessions.filter((x) => x.lie_type === l);
    const att = s.reduce((a, x) => a + x.attempts, 0);
    const in1 = s.reduce((a, x) => a + x.in_1m, 0);
    return { lie: l, name: LIE_LABELS[l], attempts: att, rate: att ? Math.round((in1 / att) * 100) : 0 };
  }).filter((d) => d.attempts > 0);

  const totalAtt = sessions.reduce((a, x) => a + x.attempts, 0);
  const totalIn1 = sessions.reduce((a, x) => a + x.in_1m, 0);
  const totalHoled = sessions.reduce((a, x) => a + x.holed, 0);
  const overall = totalAtt ? Math.round((totalIn1 / totalAtt) * 100) : 0;
  const weakest = [...byLie].sort((a, b) => a.rate - b.rate)[0];

  const barColor = (rate: number) => (rate >= 60 ? "#22c55e" : rate >= 40 ? "#f59e0b" : "#ef4444");

  // Dispersion: gather shots (optionally filtered by lie).
  const allShots: Shot[] = sessions
    .filter((s) => lieFilter === "all" || s.lie_type === lieFilter)
    .flatMap((s) => s.shots ?? []);
  const disp = dispersionStats(allShots);

  if (totalAtt === 0) {
    return (
      <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
        まだデータがありません。<br />「計測する」から記録を始めましょう。
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="総打数" value={totalAtt} accent="var(--fg)" />
        <Stat label="1m成功率" value={overall} unit="%" accent="var(--green)" />
        <Stat label="カップイン" value={totalHoled} accent="#fbbf24" />
      </div>

      {weakest && weakest.rate < 50 && (
        <Card>
          <div className="text-sm">
            <span style={{ color: "var(--red)" }}>🔻 明確な弱点：</span>{" "}
            <b>{weakest.name}</b> の成功率は <b>{weakest.rate}%</b>。
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            AIコーチがこの状況のドリルを優先して提案します。
          </div>
        </Card>
      )}

      {/* Dispersion map */}
      {disp && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              ディスパーション・マップ（着弾の散らばり）
            </div>
            <select
              value={lieFilter}
              onChange={(e) => setLieFilter(e.target.value as LieType | "all")}
              className="text-xs px-2 py-1"
            >
              <option value="all">全ライ</option>
              {LIE_ORDER.map((l) => (
                <option key={l} value={l}>{LIE_LABELS[l]}</option>
              ))}
            </select>
          </div>

          <svg viewBox={`0 0 ${SVG} ${SVG}`} className="w-full" style={{ maxHeight: 280 }}>
            <rect width={SVG} height={SVG} fill="#0c3a24" rx="14" />
            <circle cx={C} cy={C} r={2 * PX_PER_M} fill="#f59e0b14" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 5" />
            <circle cx={C} cy={C} r={1 * PX_PER_M} fill="#22c55e1f" stroke="#22c55e" strokeWidth="2" />
            <line x1={C} y1={C} x2={C} y2={C - 34} stroke="#fff" strokeWidth="2" />
            <circle cx={C} cy={C - 34} r="5" fill="#ef4444" />
            {allShots.map((s, i) => {
              const p = metersToPx(s.dx, s.dy);
              return <circle key={i} cx={p.x} cy={p.y} r="4.5" fill={ZONE_COLOR[s.zone]} opacity="0.85" />;
            })}
            {/* centroid (重心) */}
            {(() => {
              const p = metersToPx(disp.centroid.dx, disp.centroid.dy);
              return (
                <g>
                  <line x1={p.x - 8} y1={p.y} x2={p.x + 8} y2={p.y} stroke="#fff" strokeWidth="2.5" />
                  <line x1={p.x} y1={p.y - 8} x2={p.x} y2={p.y + 8} stroke="#fff" strokeWidth="2.5" />
                </g>
              );
            })()}
            <text x="8" y={SVG - 8} fill="#93a4bf" fontSize="10">手前 / 奥・左右で癖を判定（✕=重心）</text>
          </svg>

          <div className="mt-2 rounded-xl p-3" style={{ background: "var(--bg-soft)" }}>
            <div className="text-sm">
              重心は <b style={{ color: "var(--cyan)" }}>{disp.dirLabel}</b>（ピンから約{disp.dist.toFixed(1)}m）・バラつき {disp.spread.toFixed(1)}m
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{disp.causeText}</div>
          </div>
        </Card>
      )}

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>状況別 1m成功率</div>
        <ResponsiveContainer width="100%" height={Math.max(180, byLie.length * 44)}>
          <BarChart data={byLie} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" width={84} tick={{ fill: "#93a4bf", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "#ffffff10" }}
              contentStyle={{ background: "#16233a", border: "1px solid #243651", borderRadius: 12, fontSize: 12 }}
              formatter={(value, _name, item) => {
                const p = item as unknown as { payload: { attempts: number } };
                return [`${value}% (${p.payload.attempts}球)`, "成功率"];
              }}
            />
            <Bar dataKey="rate" radius={[0, 8, 8, 0]} label={{ position: "right", fill: "#eaf2ff", fontSize: 11, formatter: (v) => `${v}%` }}>
              {byLie.map((d, i) => (
                <Cell key={i} fill={barColor(d.rate)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>履歴</div>
        <div className="space-y-1.5">
          {sessions.slice(0, 12).map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm">
              <span>{LIE_LABELS[s.lie_type]} · {s.distance_m ?? "—"}m</span>
              <span style={{ color: "var(--muted)" }}>
                {s.in_1m}/{s.attempts}（{s.attempts ? Math.round((s.in_1m / s.attempts) * 100) : 0}%）
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
