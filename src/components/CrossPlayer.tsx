"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, SeverityBadge } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { drawSkeleton, type Frame } from "@/lib/pose";
import { detectEvents, EVENT_NAMES } from "@/lib/ghost-sync";
import type { Clip } from "@/lib/clip";
import type { CrossResult } from "@/lib/cross-angle";

type Slot = "front" | "dtl";
const SLOT_LABEL: Record<Slot, string> = { front: "正面", dtl: "後方(DTL)" };

export function SyncBadge({ front, dtl }: { front: Clip; dtl: Clip }) {
  const t = useT();
  const bothAudio = front.impactSource === "audio" && dtl.impactSource === "audio";
  return (
    <Card className="py-3">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
          style={{ background: bothAudio ? "var(--green)" : "var(--amber)", color: "#03260f" }}
        >
          {bothAudio ? t("打音シンクロ") : t("骨格シンクロ")}
        </span>
        <span style={{ color: "var(--muted)" }}>
          {bothAudio
            ? t("両動画のインパクト打音でミリ秒同期しました。")
            : t("音声が弱いため、一部は骨格の最速点で同期しています。下のスライダーで微調整できます。")}
        </span>
      </div>
    </Card>
  );
}

const SPEEDS = [
  { label: "x0.25", v: 0.25 },
  { label: "x0.5", v: 0.5 },
  { label: "x1", v: 1 },
];
const STEP = 1 / 30; // ≈ 0.033s（1コマ送り）

export function TwinPlayer({
  front,
  dtl,
  leftHanded,
}: {
  front: Clip;
  dtl: Clip;
  leftHanded: boolean;
}) {
  const t = useT();
  const vF = useRef<HTMLVideoElement>(null);
  const vB = useRef<HTMLVideoElement>(null);
  const cF = useRef<HTMLCanvasElement>(null);
  const cB = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const tauRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(SPEEDS[1].v);
  const offsetRef = useRef(0);
  const lastUIRef = useRef(0);

  const [tau, setTau] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedI, setSpeedI] = useState(1);
  const [showSkel, setShowSkel] = useState(true);
  const showSkelRef = useRef(true);
  const [offsetMs, setOffsetMs] = useState(0);
  const [layout, setLayout] = useState<"row" | "col">(front.aspect < 1 ? "col" : "row");

  const tauMin = useMemo(
    () => Math.max(front.times[0] - front.impact, dtl.times[0] - dtl.impact),
    [front, dtl],
  );
  const tauMax = useMemo(
    () =>
      Math.min(
        front.times[front.times.length - 1] - front.impact,
        dtl.times[dtl.times.length - 1] - dtl.impact,
      ),
    [front, dtl],
  );

  // Front-view event times relative to impact (for the phase label).
  const evTau = useMemo(() => {
    const ev = detectEvents(front.flat, leftHanded);
    return ev.map((i) => {
      const idx = Math.max(0, Math.min(front.times.length - 1, Math.round(i)));
      return front.times[idx] - front.impact;
    });
  }, [front, leftHanded]);
  const eventName = useCallback(
    (t: number) => {
      let idx = 0;
      for (let k = 0; k < evTau.length; k++) if (t >= evTau[k] - 1e-6) idx = k;
      return EVENT_NAMES[idx];
    },
    [evTau],
  );

  const nearest = (clip: Clip, t: number): Frame => {
    const ts = clip.times;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < ts.length; i++) {
      const d = Math.abs(ts[i] - t);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return clip.frames[bi];
  };

  const drawOverlay = useCallback(
    (canvas: HTMLCanvasElement | null, clip: Clip, mediaT: number, color: string) => {
      if (!canvas) return;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      if (showSkelRef.current) drawSkeleton(ctx, nearest(clip, mediaT), w, h, color);
    },
    [],
  );

  const render = useCallback(() => {
    const tt = tauRef.current;
    drawOverlay(cF.current, front, front.impact + tt, "#22d3ee");
    drawOverlay(cB.current, dtl, dtl.impact + tt + offsetRef.current, "#22c55e");
  }, [front, dtl, drawOverlay]);

  // Position both videos at τ (relative to impact) and redraw overlays.
  const apply = useCallback(
    (t: number) => {
      const tt = Math.max(tauMin, Math.min(tauMax, t));
      tauRef.current = tt;
      if (vF.current) vF.current.currentTime = front.impact + tt;
      if (vB.current) vB.current.currentTime = dtl.impact + tt + offsetRef.current;
      render();
      setTau(tt);
    },
    [front, dtl, tauMin, tauMax, render],
  );

  useEffect(() => {
    showSkelRef.current = showSkel;
    render();
  }, [showSkel, render]);

  useEffect(() => {
    offsetRef.current = offsetMs / 1000;
    if (!playingRef.current) apply(tauRef.current);
  }, [offsetMs, apply]);

  useEffect(() => {
    speedRef.current = SPEEDS[speedI].v;
    if (vF.current) vF.current.playbackRate = speedRef.current;
    if (vB.current) vB.current.playbackRate = speedRef.current;
  }, [speedI]);

  // Initial positioning once both videos can render a frame.
  useEffect(() => {
    const t = setTimeout(() => apply(0), 250);
    return () => clearTimeout(t);
  }, [apply]);

  const tickRef = useRef<() => void>(() => {});
  const tick = useCallback(() => {
    if (!playingRef.current) return;
    const vf = vF.current;
    const vb = vB.current;
    if (vf && vb) {
      let t = vf.currentTime - front.impact;
      if (t >= tauMax) {
        t = tauMin;
        vf.currentTime = front.impact + tauMin;
        vb.currentTime = dtl.impact + tauMin + offsetRef.current;
      } else {
        // Keep the back video locked to the front (correct any drift).
        const bt = dtl.impact + t + offsetRef.current;
        if (Math.abs(vb.currentTime - bt) > 0.06) vb.currentTime = bt;
      }
      tauRef.current = t;
      render();
      const now = performance.now();
      if (now - lastUIRef.current > 60) {
        lastUIRef.current = now;
        setTau(t);
      }
    }
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [front, dtl, tauMin, tauMax, render]);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startPlay = useCallback(() => {
    const vf = vF.current;
    const vb = vB.current;
    if (!vf || !vb) return;
    if (tauRef.current >= tauMax - 1e-3) tauRef.current = tauMin;
    vf.playbackRate = speedRef.current;
    vb.playbackRate = speedRef.current;
    vf.currentTime = front.impact + tauRef.current;
    vb.currentTime = dtl.impact + tauRef.current + offsetRef.current;
    vf.play().catch(() => {});
    vb.play().catch(() => {});
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [front, dtl, tauMin, tauMax]);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) {
      startPlay();
    } else {
      cancelAnimationFrame(rafRef.current);
      vF.current?.pause();
      vB.current?.pause();
      render();
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, startPlay, render]);

  const seek = (t: number) => {
    setPlaying(false);
    apply(t);
  };

  const cell = (slot: Slot) => {
    const clip = slot === "front" ? front : dtl;
    const vref = slot === "front" ? vF : vB;
    const cref = slot === "front" ? cF : cB;
    return (
      <div
        className="relative rounded-xl overflow-hidden"
        style={{ background: "#0b1220", border: "1px solid var(--line)", aspectRatio: `${clip.aspect}` }}
      >
        <video
          ref={vref}
          src={clip.url}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-contain"
        />
        <canvas ref={cref} className="absolute inset-0 w-full h-full pointer-events-none" />
        <span
          className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold"
          style={{ background: slot === "front" ? "#22d3ee" : "#22c55e", color: "#04121f" }}
        >
          {t(SLOT_LABEL[slot])}
        </span>
      </div>
    );
  };

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold">
          {t(eventName(tau))}{" "}
          <span style={{ color: "var(--muted)" }}>
            {t("（IMP {ms}ms）", { ms: (tau >= 0 ? "+" : "") + Math.round(tau * 1000) })}
          </span>
        </div>
        <div className="flex gap-1">
          {(["row", "col"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLayout(l)}
              className="px-2 py-0.5 rounded text-[11px]"
              style={{
                background: layout === l ? "var(--green)" : "var(--bg-soft)",
                color: layout === l ? "#03260f" : "var(--muted)",
              }}
            >
              {l === "row" ? t("左右") : t("上下")}
            </button>
          ))}
        </div>
      </div>

      <div className={layout === "row" ? "grid grid-cols-2 gap-2" : "grid grid-cols-1 gap-2"}>
        {cell("front")}
        {cell("dtl")}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => seek(tauRef.current - STEP)}
          className="btn btn-ghost w-9 h-9 grid place-items-center"
          aria-label={t("1コマ戻る")}
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
          onClick={() => seek(tauRef.current + STEP)}
          className="btn btn-ghost w-9 h-9 grid place-items-center"
          aria-label={t("1コマ進む")}
        >
          ▶|
        </button>
        <input
          type="range"
          min={tauMin}
          max={tauMax}
          step={0.001}
          value={tau}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1"
        />
      </div>

      {/* Speed + skeleton toggle */}
      <div className="flex items-center justify-between mt-2">
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
        <button
          onClick={() => setShowSkel((s) => !s)}
          className="px-2 py-0.5 rounded text-[11px]"
          style={{
            background: showSkel ? "var(--cyan)" : "var(--bg-soft)",
            color: showSkel ? "#04121f" : "var(--muted)",
          }}
        >
          {t("骨格")} {showSkel ? "ON" : "OFF"}
        </button>
      </div>

      {/* Event jump chips */}
      <div className="grid grid-cols-4 gap-1 mt-2">
        {EVENT_NAMES.map((name, i) => {
          const active = eventName(tau) === name;
          const target = evTau[i] ?? 0;
          return (
            <button
              key={name}
              onClick={() => seek(target)}
              className="px-1 py-1.5 rounded text-[10px] leading-tight"
              style={{
                background: active ? "var(--cyan)" : "var(--bg-soft)",
                color: active ? "#04121f" : "var(--muted)",
              }}
            >
              {t(name)}
            </button>
          );
        })}
      </div>

      {/* Fine-tune offset */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
          <span>
            {t("同期の微調整（後方を {ms}ms ずらす）", {
              ms: (offsetMs >= 0 ? "+" : "") + offsetMs,
            })}
          </span>
          {offsetMs !== 0 && (
            <button onClick={() => setOffsetMs(0)} style={{ color: "var(--green)" }}>
              {t("リセット")}
            </button>
          )}
        </div>
        <input
          type="range"
          min={-250}
          max={250}
          step={5}
          value={offsetMs}
          onChange={(e) => setOffsetMs(Number(e.target.value))}
          className="w-full mt-1"
        />
      </div>

      <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
        {t(
          "打音を基準に2本を整列。スライダーや◀▶で約{ms}msずつ、正面・後方を同時にスロー再生・巻き戻しできます。骨格オーバーレイは端末内推定です。",
          { ms: Math.round(STEP * 1000) },
        )}
      </p>
    </Card>
  );
}

const sevColor: Record<string, string> = {
  high: "var(--red)",
  mid: "var(--amber)",
  low: "var(--cyan)",
  ok: "var(--green)",
};

export function CrossReport({ result }: { result: CrossResult }) {
  const t = useT();
  return (
    <>
      <Card>
        <div className="text-sm font-bold mb-1">🔬 {t("クロスアングル診断")}</div>
        <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
          {t("正面と後方を組み合わせて初めて分かる「立体的なスイングエラー」の真因です。")}
        </p>
        <div className="space-y-3">
          {result.findings.map((f) => (
            <div
              key={f.code}
              className="rounded-xl p-3"
              style={{ background: "var(--bg-soft)", borderLeft: `3px solid ${sevColor[f.severity]}` }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="font-semibold text-sm">{f.title}</div>
                {f.severity !== "ok" && <SeverityBadge severity={f.severity} />}
              </div>
              <div className="space-y-1 text-[12px]">
                <div className="flex gap-1.5">
                  <span className="font-bold shrink-0" style={{ color: "#22d3ee" }}>
                    {t("正面")}
                  </span>
                  <span style={{ color: "var(--muted)" }}>{f.front.replace(/^正面[：:]\s*/, "")}</span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-bold shrink-0" style={{ color: "#22c55e" }}>
                    {t("後方")}
                  </span>
                  <span style={{ color: "var(--muted)" }}>{f.dtl.replace(/^後方[：:]\s*/, "")}</span>
                </div>
                <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--line)" }}>
                  <span className="font-bold" style={{ color: "var(--fg)" }}>
                    {t("真因 ▶︎")}{" "}
                  </span>
                  <span>{f.truth}</span>
                </div>
                <div style={{ color: "var(--green)" }}>💡 {f.advice}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          {t("計測値（アドレス→インパクト）")}
        </div>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="font-bold mb-1" style={{ color: "#22d3ee" }}>
              {t("正面ビュー")}
            </div>
            <Row label={t("頭の上下動")} value={`${result.front.headDropCm} cm`} />
            <Row label={t("腰の横移動")} value={`${result.front.swayCm} cm`} />
          </div>
          <div>
            <div className="font-bold mb-1" style={{ color: "#22c55e" }}>
              {t("後方ビュー")}
            </div>
            <Row
              label={t("前傾角の変化")}
              value={`${result.dtl.spineDelta >= 0 ? "+" : ""}${result.dtl.spineDelta}°`}
            />
            <Row label={t("お尻の前後動")} value={`${result.dtl.hipMoveCm} cm`} />
          </div>
        </div>
        <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
          {t("※ 2D骨格からの推定値です。被写体の大きさ・撮影角度で多少前後します。")}
        </p>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
