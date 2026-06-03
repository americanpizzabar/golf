"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { PageHeader, Card, Spinner } from "@/components/ui";
import { drawSkeleton, LM, type Frame } from "@/lib/pose";
import { expandFrame, wristSpeedSeries } from "@/lib/swing";
import { fetchSwings, getProfile } from "@/lib/db";
import type { Swing } from "@/lib/types";

export default function GhostPage() {
  const [swings, setSwings] = useState<Swing[]>([]);
  const [leftHanded, setLeftHanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");

  useEffect(() => {
    (async () => {
      const [sw, p] = await Promise.all([fetchSwings(60), getProfile()]);
      setLeftHanded(p?.dominant_hand === "left");
      const withFrames = sw.filter((s) => s.pose_frames && s.pose_frames.length > 4);
      setSwings(withFrames);
      if (withFrames.length) {
        setAId(withFrames[0].id); // latest
        const best = [...withFrames].sort((x, y) => (y.sync_rate ?? 0) - (x.sync_rate ?? 0))[0];
        setBId(best.id !== withFrames[0].id ? best.id : (withFrames[1]?.id ?? best.id));
      }
      setLoaded(true);
    })();
  }, []);

  const a = swings.find((s) => s.id === aId);
  const b = swings.find((s) => s.id === bId);

  return (
    <main>
      <PageHeader title="ゴースト比較" subtitle="ベストスイングと重ねて加速を可視化" back />
      <div className="px-4 space-y-4">
        {!loaded ? (
          <Card className="text-center py-8"><Spinner label="読み込み中…" /></Card>
        ) : swings.length < 2 ? (
          <Card className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
            比較には保存済みスイングが2つ以上必要です。<br />
            <Link href="/swing" style={{ color: "var(--green)" }}>スイング解析</Link>
            を数回保存してください。
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
                    {swings.map((s) => (
                      <option key={s.id} value={s.id}>{label(s)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </Card>

            {a && b && (
              <>
                <GhostPlayer a={a.pose_frames!} b={b.pose_frames!} />
                <SpeedTimeline a={a} b={b} leftHanded={leftHanded} />
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function label(s: Swing) {
  const d = new Date(s.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${d}・${s.sync_rate ?? "—"}%${s.head_speed ? `・${s.head_speed}m/s` : ""}`;
}

// Per-swing transform so both golfers are centered & same size when overlaid.
function transformOf(frames: number[][]) {
  const f0 = expandFrame(frames[0]);
  const midHip = { x: (f0[LM.lHip].x + f0[LM.rHip].x) / 2, y: (f0[LM.lHip].y + f0[LM.rHip].y) / 2 };
  const ankle = (f0[LM.lAnkle].y + f0[LM.rAnkle].y) / 2;
  const bodyH = Math.abs(ankle - f0[LM.nose].y) || 0.5;
  const scale = 0.55 / bodyH;
  return (frame: Frame): Frame =>
    frame.map((p) => ({ ...p, x: 0.5 + (p.x - midHip.x) * scale, y: 0.62 + (p.y - midHip.y) * scale }));
}

function GhostPlayer({ a, b }: { a: number[][]; b: number[][] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const rafRef = useRef(0);
  const tRef = useRef(0);

  const txA = transformOf(a);
  const txB = transformOf(b);

  useEffect(() => {
    const SIZE = 360;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const ia = Math.round(t * (a.length - 1));
    const ib = Math.round(t * (b.length - 1));
    // ghost (B) behind, translucent
    ctx.globalAlpha = 0.45;
    drawSkeleton(ctx, txB(expandFrame(b[ib])), SIZE, SIZE, "#f59e0b");
    ctx.globalAlpha = 1;
    drawSkeleton(ctx, txA(expandFrame(a[ia])), SIZE, SIZE, "#22d3ee");
  }, [t, a, b, txA, txB]);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      tRef.current = (tRef.current + dt / 2) % 1; // ~2s loop
      setT(tRef.current);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  return (
    <Card className="p-3">
      <div className="rounded-xl overflow-hidden mx-auto" style={{ background: "#0b1220", border: "1px solid var(--line)", maxWidth: 360 }}>
        <canvas ref={canvasRef} width={360} height={360} className="w-full" />
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={() => setPlaying((p) => !p)} className="btn btn-ghost px-4 py-2 text-sm">
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={t}
          onChange={(e) => {
            setPlaying(false);
            tRef.current = Number(e.target.value);
            setT(tRef.current);
          }}
          className="flex-1"
        />
        <span className="text-xs w-20 text-right" style={{ color: "var(--muted)" }}>
          {t < 0.33 ? "始動〜トップ" : t < 0.6 ? "ダウン" : t < 0.75 ? "インパクト" : "フォロー"}
        </span>
      </div>
    </Card>
  );
}

function SpeedTimeline({ a, b, leftHanded }: { a: Swing; b: Swing; leftHanded: boolean }) {
  const sa = wristSpeedSeries(a.pose_frames!, leftHanded);
  const sb = wristSpeedSeries(b.pose_frames!, leftHanded);
  const maxV = Math.max(0.0001, ...sa, ...sb);
  const N = 24;
  const sample = (s: number[], u: number) => (s.length ? s[Math.round(u * (s.length - 1))] : 0);
  const data = Array.from({ length: N }, (_, i) => {
    const u = i / (N - 1);
    return {
      p: Math.round(u * 100),
      now: Math.round((sample(sa, u) / maxV) * 100),
      ghost: Math.round((sample(sb, u) / maxV) * 100),
    };
  });

  return (
    <Card>
      <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>
        手元スピードの加速プロセス（スイング進行 % ／ 相対スピード）
      </div>
      <p className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>
        ピークがインパクト直前で、その後に減速していれば効率よく加速できています。
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
          <XAxis dataKey="p" unit="%" tick={{ fill: "#93a4bf", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#93a4bf", fontSize: 10 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: "#16233a", border: "1px solid #243651", borderRadius: 12, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="now" name="現在" stroke="#22d3ee" strokeWidth={3} dot={false} />
          <Line type="monotone" dataKey="ghost" name="ゴースト" stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="5 4" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
