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

const ZONE_COLOR: Record<Shot["zone"], string> = {
  holed: "#fbbf24",
  in1: "#22c55e",
  in2: "#f59e0b",
  out: "#ef4444",
};

function zoneOfDist(d: number): Shot["zone"] {
  if (d <= 0.15) return "holed";
  if (d <= 1) return "in1";
  if (d <= 2) return "in2";
  return "out";
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}

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
      <PageHeader title="アプローチ計測" subtitle="目標点を設定して着弾を自動計測" back />
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
  const diffRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<Uint8ClampedArray | null>(null);
  const rafRef = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);

  // Detector state (refs so the rAF loop reads latest values).
  const measuringRef = useRef(false);
  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const r1mRef = useRef(0.13);
  const activeRef = useRef(false);
  const settleRef = useRef(0);
  const lastCentroidRef = useRef<{ x: number; y: number } | null>(null);
  const lastShotMsRef = useRef(0);

  const [camOn, setCamOn] = useState(false);
  const [phase, setPhase] = useState<"target" | "measuring">("target");
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const [r1m, setR1m] = useState(0.13);
  const [shots, setShots] = useState<Shot[]>([]);
  const [flash, setFlash] = useState(false);
  const [lie, setLie] = useState<LieType>("flat");
  const [distance, setDistance] = useState("20");

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    cancelAnimationFrame(rafRef.current);
  }, []);

  async function startCam() {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。");
      return;
    }
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
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
    if (!diffRef.current) {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      diffRef.current = c;
    }
    prevRef.current = null;
    setCamOn(true);
    rafRef.current = requestAnimationFrame(detectLoop);
  }

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setCamOn(false);
    setPhase("target");
    measuringRef.current = false;
  }

  // Center-crop the video into a square so detector coords match the displayed
  // (object-cover) square overlay.
  function sampleSquare(): ImageData | null {
    const video = videoRef.current;
    const c = diffRef.current;
    if (!video || !c || video.readyState < 2 || !video.videoWidth) return null;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const side = Math.min(vw, vh);
    ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  // 背景差分による着弾検知：動きの重心を追い、静止した瞬間の位置を着弾点とする。β。
  function detectLoop(now: number) {
    const c = diffRef.current;
    if (c && measuringRef.current && targetRef.current) {
      const cur = sampleSquare();
      const prev = prevRef.current;
      if (cur) {
        if (prev) {
          let sx = 0;
          let sy = 0;
          let cnt = 0;
          const w = c.width;
          const data = cur.data;
          for (let i = 0; i < data.length; i += 4) {
            const d = Math.abs(data[i] - prev[i]) + Math.abs(data[i + 1] - prev[i + 1]) + Math.abs(data[i + 2] - prev[i + 2]);
            if (d > 90) {
              const px = (i / 4) % w;
              const py = Math.floor(i / 4 / w);
              sx += px;
              sy += py;
              cnt++;
            }
          }
          const motion = cnt / (data.length / 4);
          if (motion > 0.015) {
            activeRef.current = true;
            settleRef.current = 0;
            lastCentroidRef.current = { x: sx / cnt / w, y: sy / cnt / c.height };
          } else if (activeRef.current) {
            settleRef.current += 1;
            // settled for a few frames → record the resting position
            if (settleRef.current > 6 && now - lastShotMsRef.current > 1500) {
              activeRef.current = false;
              const cpt = lastCentroidRef.current;
              const tgt = targetRef.current;
              if (cpt && tgt) {
                lastShotMsRef.current = now;
                registerShot(cpt.x, cpt.y, tgt, r1mRef.current);
              }
            }
          }
        }
        prevRef.current = cur.data.slice(0) as unknown as Uint8ClampedArray;
      }
    }
    rafRef.current = requestAnimationFrame(detectLoop);
  }

  function registerShot(nx: number, ny: number, tgt: { x: number; y: number }, r1: number) {
    const dx = (nx - tgt.x) / r1;
    const dy = -(ny - tgt.y) / r1;
    const dist = Math.hypot(dx, dy);
    const shot: Shot = { dx: round1(dx), dy: round1(dy), zone: zoneOfDist(dist) };
    setShots((s) => [...s, shot]);
    if (navigator.vibrate) navigator.vibrate(shot.zone === "out" ? 30 : 15);
    setFlash(true);
    setTimeout(() => setFlash(false), 700);
  }

  function onSvgTap(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (phase === "target") {
      setTarget({ x: nx, y: ny });
      targetRef.current = { x: nx, y: ny };
    } else {
      // Manual fallback during measuring: tap where the ball stopped.
      const tgt = targetRef.current;
      if (tgt) registerShot(nx, ny, tgt, r1mRef.current);
    }
  }

  function startMeasuring() {
    if (!target) return;
    measuringRef.current = true;
    activeRef.current = false;
    settleRef.current = 0;
    setPhase("measuring");
  }
  function stopMeasuring() {
    measuringRef.current = false;
    setPhase("target");
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

  // overlay positions
  const tPx = target ? { x: target.x * 100, y: target.y * 100 } : null;
  const markerPos = (s: Shot) =>
    target ? { x: (target.x + s.dx * r1m) * 100, y: (target.y - s.dy * r1m) * 100 } : { x: 50, y: 50 };

  return (
    <div className="space-y-4">
      <Card className="p-0 overflow-hidden">
        <div className="relative aspect-square" style={{ background: "#0a2417" }}>
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
            style={{ display: camOn ? "block" : "none" }}
          />
          <svg ref={svgRef} viewBox="0 0 100 100" className="absolute inset-0 w-full h-full touch-none" onClick={onSvgTap}>
            {!camOn && <rect width="100" height="100" fill="#0c3a24" />}
            {tPx && (
              <>
                <circle cx={tPx.x} cy={tPx.y} r={2 * r1m * 100} fill="#f59e0b14" stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="2.5 1.8" />
                <circle cx={tPx.x} cy={tPx.y} r={r1m * 100} fill="#22c55e1f" stroke="#22c55e" strokeWidth="0.8" />
                <line x1={tPx.x} y1={tPx.y} x2={tPx.x} y2={tPx.y - 11} stroke="#fff" strokeWidth="0.7" />
                <circle cx={tPx.x} cy={tPx.y - 11} r="1.6" fill="#ef4444" />
                <circle cx={tPx.x} cy={tPx.y} r="1.3" fill="#fff" />
              </>
            )}
            {shots.map((s, i) => {
              const p = markerPos(s);
              return <circle key={i} cx={p.x} cy={p.y} r="1.8" fill={ZONE_COLOR[s.zone]} stroke="#0a2417" strokeWidth="0.5" />;
            })}
          </svg>

          {!camOn && (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div>
                <div className="text-4xl mb-2">🎯</div>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  カメラをグリーンに向けて<br />目標点（ピン）を設定します
                </p>
              </div>
            </div>
          )}

          {camOn && (
            <div className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold"
              style={{ background: phase === "measuring" ? "var(--red)" : "rgba(0,0,0,0.6)", color: "#fff" }}>
              {phase === "target"
                ? target ? "目標点を設定済み（タップで変更）" : "ピンの位置をタップ"
                : flash ? "● 着弾を記録！" : "● 計測中… 着弾を自動検知"}
            </div>
          )}
          {camOn && (
            <button onClick={stopCam} className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5">
              カメラOFF
            </button>
          )}
        </div>
      </Card>

      {!camOn ? (
        <button onClick={startCam} className="btn btn-primary w-full py-3.5">
          📷 カメラを起動して目標を設定
        </button>
      ) : phase === "target" ? (
        <>
          <Card>
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>
              1mリングの大きさを実際のグリーンに合わせる
            </div>
            <input
              type="range"
              min={0.05}
              max={0.3}
              step={0.005}
              value={r1m}
              onChange={(e) => {
                const v = Number(e.target.value);
                setR1m(v);
                r1mRef.current = v;
              }}
              className="w-full"
            />
            <div className="text-[11px]" style={{ color: "var(--muted)" }}>
              緑の円がピンから半径1mに見えるよう調整してください。
            </div>
          </Card>
          <button onClick={startMeasuring} disabled={!target} className="btn btn-primary w-full py-3.5 disabled:opacity-40">
            ▶ 計測開始（着弾を自動検知）
          </button>
        </>
      ) : (
        <button onClick={stopMeasuring} className="btn py-3.5 w-full font-bold" style={{ background: "var(--red)", color: "#fff" }}>
          ■ 計測を停止
        </button>
      )}

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

      <div className="grid grid-cols-4 gap-2">
        <Stat label="打数" value={tally.attempts} accent="var(--fg)" />
        <Stat label="1m以内" value={tally.in_1m} accent="var(--green)" />
        <Stat label="成功率" value={rate1} unit="%" accent="var(--cyan)" />
        <Stat label="カップイン" value={tally.holed} accent="#fbbf24" />
      </div>

      <button onClick={() => setShots((s) => s.slice(0, -1))} disabled={!shots.length} className="btn btn-ghost py-3 w-full disabled:opacity-40">
        ↩ 直前の1球を取り消し
      </button>

      <button onClick={save} disabled={!tally.attempts} className="btn btn-primary w-full py-3.5 disabled:opacity-40">
        このセッションを保存（{tally.attempts}球）
      </button>

      <p className="text-[11px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
        ※ 計測開始後はカメラ映像の背景差分で着弾（動きが止まった位置）を常時自動検知します。撮影環境により精度は変わるため、検知漏れ時は画面を直接タップして着弾点を記録できます（β）。
      </p>
    </div>
  );
}

const D_SVG = 300;
const D_C = D_SVG / 2;
const D_PXM = 30;

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

      {disp && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs" style={{ color: "var(--muted)" }}>ディスパーション・マップ（着弾の散らばり）</div>
            <select value={lieFilter} onChange={(e) => setLieFilter(e.target.value as LieType | "all")} className="text-xs px-2 py-1">
              <option value="all">全ライ</option>
              {LIE_ORDER.map((l) => (
                <option key={l} value={l}>{LIE_LABELS[l]}</option>
              ))}
            </select>
          </div>
          <svg viewBox={`0 0 ${D_SVG} ${D_SVG}`} className="w-full" style={{ maxHeight: 280 }}>
            <rect width={D_SVG} height={D_SVG} fill="#0c3a24" rx="14" />
            <circle cx={D_C} cy={D_C} r={2 * D_PXM} fill="#f59e0b14" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 5" />
            <circle cx={D_C} cy={D_C} r={1 * D_PXM} fill="#22c55e1f" stroke="#22c55e" strokeWidth="2" />
            <line x1={D_C} y1={D_C} x2={D_C} y2={D_C - 34} stroke="#fff" strokeWidth="2" />
            <circle cx={D_C} cy={D_C - 34} r="5" fill="#ef4444" />
            {allShots.map((s, i) => (
              <circle key={i} cx={D_C + s.dx * D_PXM} cy={D_C - s.dy * D_PXM} r="4.5" fill={ZONE_COLOR[s.zone]} opacity="0.85" />
            ))}
            {(() => {
              const px = D_C + disp.centroid.dx * D_PXM;
              const py = D_C - disp.centroid.dy * D_PXM;
              return (
                <g>
                  <line x1={px - 8} y1={py} x2={px + 8} y2={py} stroke="#fff" strokeWidth="2.5" />
                  <line x1={px} y1={py - 8} x2={px} y2={py + 8} stroke="#fff" strokeWidth="2.5" />
                </g>
              );
            })()}
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
