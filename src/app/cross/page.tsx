"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, Card, Spinner, SeverityBadge } from "@/components/ui";
import { getPoseLandmarker, drawSkeleton, type Frame } from "@/lib/pose";
import { detectEvents, EVENT_NAMES } from "@/lib/ghost-sync";
import { getProfile } from "@/lib/db";
import { crossAnalyze, toFlat, type CrossResult } from "@/lib/cross-angle";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";

type Slot = "front" | "dtl";
type Stage = "idle" | "processing" | "ready";

interface Clip {
  url: string;
  aspect: number;
  duration: number;
  frames: Frame[]; // full landmarks (for skeleton overlay)
  flat: number[][]; // compact [x,y,...] (for analysis / events)
  times: number[]; // media time (s) of each extracted frame
  impact: number; // media time (s) of the impact (sync anchor)
  impactSource: "audio" | "pose";
}

type RVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};

const SLOT_LABEL: Record<Slot, string> = { front: "正面", dtl: "後方(DTL)" };

// --- Audio impact detection ------------------------------------------------
// The loud, sharp transient of the impact (打音 / 打球音) is the most reliable
// shared event across two phones. We find the window with the largest onset
// (sudden rise in energy) weighted by loudness. Returns media seconds, or null
// if the clip has no usable audio.
async function findImpactAudio(file: File): Promise<number | null> {
  try {
    const ab = await file.arrayBuffer();
    type ACtor = typeof AudioContext;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: ACtor }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const buf = await ctx.decodeAudioData(ab);
    await ctx.close();
    const data = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.max(1, Math.round(sr * 0.008)); // ~8ms windows
    const n = Math.floor(data.length / hop);
    if (n < 4) return null;
    const rms = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * hop;
      for (let j = 0; j < hop; j++) {
        const v = data[o + j];
        s += v * v;
      }
      rms[i] = Math.sqrt(s / hop);
    }
    let best = -1;
    let bi = 0;
    for (let i = 1; i < n; i++) {
      const onset = Math.max(0, rms[i] - rms[i - 1]);
      const score = onset * rms[i];
      if (score > best) {
        best = score;
        bi = i;
      }
    }
    if (best <= 0) return null;
    return (bi * hop) / sr;
  } catch {
    return null;
  }
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.05) return resolve();
    const on = () => {
      video.removeEventListener("seeked", on);
      resolve();
    };
    video.addEventListener("seeked", on);
    const g = setTimeout(() => {
      video.removeEventListener("seeked", on);
      resolve();
    }, 1200);
    try {
      video.currentTime = t;
    } catch {
      clearTimeout(g);
      resolve();
    }
  });
}

// Extract pose frames (+ media timestamps) from a clip, and pick the impact
// anchor. Audio impact is preferred; pose-based (fastest-hand frame) is the
// fallback when the clip has no audio.
async function extractClip(
  file: File,
  model: PoseLandmarker,
  leftHanded: boolean,
  onPct: (p: number) => void,
): Promise<Clip> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";

  await new Promise<void>((res) => {
    if (video.readyState >= 1 && video.duration) return res();
    video.onloadedmetadata = () => res();
    setTimeout(res, 4000);
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const aspect =
    video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 3 / 4;

  const audioImpact = await findImpactAudio(file);
  let start = 0;
  let end = duration;
  if (audioImpact != null && duration > 0) {
    start = Math.max(0, audioImpact - 1.5);
    end = Math.min(duration, audioImpact + 0.8);
  }

  // Small capped detection canvas keeps memory/CPU bounded on phones.
  const cc = document.createElement("canvas");
  const TARGET = 540;
  const detectSource = (): HTMLCanvasElement => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = TARGET / Math.max(vw, vh);
    const dw = Math.max(1, Math.round(vw * scale));
    const dh = Math.max(1, Math.round(vh * scale));
    if (cc.width !== dw || cc.height !== dh) {
      cc.width = dw;
      cc.height = dh;
    }
    const cx = cc.getContext("2d");
    if (cx) cx.drawImage(video, 0, 0, dw, dh);
    return cc;
  };

  await seekTo(video, start);
  const frames: Frame[] = [];
  const times: number[] = [];
  const MAX = 200;
  const MIN_DT = 0.02;
  let lastProc = -1;
  let lastTs = performance.now();
  video.playbackRate = 0.6;
  await video.play().catch(() => {});
  const rvfc = video as RVFC;
  const hasRVFC = typeof rvfc.requestVideoFrameCallback === "function";

  await new Promise<void>((resolve) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      resolve();
    };
    const schedule = () => {
      if (stopped) return;
      if (hasRVFC) rvfc.requestVideoFrameCallback!(grab);
      else requestAnimationFrame(grab);
    };
    const grab = () => {
      if (stopped) return;
      const t = video.currentTime;
      if (video.ended || video.paused || t >= end || frames.length >= MAX) return stop();
      if (t - lastProc >= MIN_DT && video.readyState >= 2 && video.videoWidth) {
        lastProc = t;
        try {
          const ts = Math.max(performance.now(), lastTs + 1);
          lastTs = ts;
          const res = model.detectForVideo(detectSource(), ts);
          const raw = res.landmarks?.[0] as Frame | undefined;
          if (raw) {
            frames.push(raw);
            times.push(t);
          }
        } catch {
          /* skip bad frame */
        }
        if (end > start) onPct(Math.min(99, Math.round(((t - start) / (end - start)) * 100)));
      }
      schedule();
    };
    schedule();
    setTimeout(stop, ((end - start) / 0.6) * 1000 + 4000);
  });

  video.pause();
  video.playbackRate = 1;
  const flat = frames.map(toFlat);

  let impact: number;
  let impactSource: "audio" | "pose";
  if (audioImpact != null && times.length) {
    impact = Math.min(Math.max(audioImpact, times[0]), times[times.length - 1]);
    impactSource = "audio";
  } else if (flat.length >= 5) {
    const ev = detectEvents(flat, leftHanded);
    impact = times[Math.max(0, Math.min(times.length - 1, Math.round(ev[5])))];
    impactSource = "pose";
  } else {
    impact = times.length ? times[Math.floor(times.length / 2)] : 0;
    impactSource = "pose";
  }

  return { url, aspect, duration, frames, flat, times, impact, impactSource };
}

export default function CrossPage() {
  const [files, setFiles] = useState<{ front?: File; dtl?: File }>({});
  const [clips, setClips] = useState<{ front?: Clip; dtl?: Clip }>({});
  const [stage, setStage] = useState<Stage>("idle");
  const [pct, setPct] = useState(0);
  const [phase, setPhase] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<CrossResult | null>(null);
  const [leftHanded, setLeftHanded] = useState(false);
  const [heightCm, setHeightCm] = useState<number>(170);

  useEffect(() => {
    (async () => {
      const p = await getProfile();
      setLeftHanded(p?.dominant_hand === "left");
      if (p?.height_cm) setHeightCm(p.height_cm);
    })();
  }, []);

  // Revoke object URLs on unmount / reset.
  const clipsRef = useRef(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  useEffect(() => {
    return () => {
      const c = clipsRef.current;
      if (c.front) URL.revokeObjectURL(c.front.url);
      if (c.dtl) URL.revokeObjectURL(c.dtl.url);
    };
  }, []);

  const onPick = (slot: Slot) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr("");
    setFiles((prev) => ({ ...prev, [slot]: f }));
  };

  const run = async () => {
    if (!files.front || !files.dtl) return;
    setErr("");
    setStage("processing");
    setResult(null);
    try {
      const model = await getPoseLandmarker();
      setPhase("正面動画を解析中…（打音を検出しています）");
      setPct(0);
      const front = await extractClip(files.front, model, leftHanded, setPct);
      setPhase("後方動画を解析中…（骨格を抽出しています）");
      setPct(0);
      const dtl = await extractClip(files.dtl, model, leftHanded, setPct);

      if (front.frames.length < 5 || dtl.frames.length < 5) {
        setErr(
          "どちらかの動画で骨格を十分に検出できませんでした。全身が大きく・明るく映った動画でお試しください。",
        );
        URL.revokeObjectURL(front.url);
        URL.revokeObjectURL(dtl.url);
        setStage("idle");
        return;
      }

      setClips({ front, dtl });
      setResult(crossAnalyze(front.flat, dtl.flat, { leftHanded, heightCm }));
      setStage("ready");
    } catch (e) {
      console.error(e);
      setErr("解析中にエラーが発生しました。動画ファイルを変えてお試しください。");
      setStage("idle");
    }
  };

  const reset = () => {
    if (clips.front) URL.revokeObjectURL(clips.front.url);
    if (clips.dtl) URL.revokeObjectURL(clips.dtl.url);
    setClips({});
    setFiles({});
    setResult(null);
    setErr("");
    setStage("idle");
  };

  return (
    <main>
      <PageHeader
        title="クロスアングル解析"
        subtitle="正面×後方を打音で完全同期・2視点で真因を判定"
        back
      />
      <div className="px-4 space-y-4 pb-8">
        {stage === "idle" && (
          <>
            <Card>
              <div className="text-sm font-semibold mb-1">2つの視点の動画を読み込み</div>
              <p className="text-[12px] mb-3" style={{ color: "var(--muted)" }}>
                同じスイングを「正面」と「後方(DTL)」から撮った2本を選んでください。打球音(打音)の
                波形を照合して、2本を1コマのズレもなく自動同期します。
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["front", "dtl"] as Slot[]).map((slot) => (
                  <label
                    key={slot}
                    className="card p-3 flex flex-col items-center justify-center text-center cursor-pointer active:scale-[0.99]"
                    style={{ borderStyle: files[slot] ? "solid" : "dashed", minHeight: 96 }}
                  >
                    <span className="text-2xl">{slot === "front" ? "🧍" : "🏌️"}</span>
                    <span className="text-xs font-semibold mt-1">{SLOT_LABEL[slot]}</span>
                    <span
                      className="text-[11px] mt-0.5 truncate max-w-full"
                      style={{ color: files[slot] ? "var(--green)" : "var(--muted)" }}
                    >
                      {files[slot] ? "✓ 選択済み" : "タップして選択"}
                    </span>
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={onPick(slot)}
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={run}
                disabled={!files.front || !files.dtl}
                className="btn w-full mt-3 py-2.5 text-sm font-bold"
                style={{
                  background: files.front && files.dtl ? "var(--green)" : "var(--bg-soft)",
                  color: files.front && files.dtl ? "#03260f" : "var(--muted)",
                }}
              >
                同期して解析する
              </button>
              {err && (
                <div className="text-xs mt-2" style={{ color: "var(--red)" }}>
                  {err}
                </div>
              )}
            </Card>
            <Card>
              <div className="text-[12px] leading-relaxed" style={{ color: "var(--muted)" }}>
                💡 同期のコツ：両方の動画に「インパクトの打音」がはっきり入っていると精度が上がります。
                音声が無い動画でも、骨格から推定した最速点(インパクト)で自動同期します。
                解析はすべて端末内(MediaPipe)で行われ、映像は送信されません。
              </div>
            </Card>
          </>
        )}

        {stage === "processing" && (
          <Card className="text-center py-8 space-y-3">
            <Spinner label={phase} />
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-soft)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: "var(--green)" }}
              />
            </div>
          </Card>
        )}

        {stage === "ready" && clips.front && clips.dtl && result && (
          <>
            <SyncBadge front={clips.front} dtl={clips.dtl} />
            <TwinPlayer front={clips.front} dtl={clips.dtl} leftHanded={leftHanded} />
            <CrossReport result={result} />
            <button onClick={reset} className="btn btn-ghost w-full py-2.5 text-sm">
              別の動画で解析する
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function SyncBadge({ front, dtl }: { front: Clip; dtl: Clip }) {
  const bothAudio = front.impactSource === "audio" && dtl.impactSource === "audio";
  return (
    <Card className="py-3">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
          style={{ background: bothAudio ? "var(--green)" : "var(--amber)", color: "#03260f" }}
        >
          {bothAudio ? "打音シンクロ" : "骨格シンクロ"}
        </span>
        <span style={{ color: "var(--muted)" }}>
          {bothAudio
            ? "両動画のインパクト打音でミリ秒同期しました。"
            : "音声が弱いため、一部は骨格の最速点で同期しています。下のスライダーで微調整できます。"}
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

function TwinPlayer({
  front,
  dtl,
  leftHanded,
}: {
  front: Clip;
  dtl: Clip;
  leftHanded: boolean;
}) {
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
          style={{
            background: slot === "front" ? "#22d3ee" : "#22c55e",
            color: "#04121f",
          }}
        >
          {SLOT_LABEL[slot]}
        </span>
      </div>
    );
  };

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold">
          {eventName(tau)}{" "}
          <span style={{ color: "var(--muted)" }}>
            （IMP {tau >= 0 ? "+" : ""}
            {Math.round(tau * 1000)}ms）
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
              {l === "row" ? "左右" : "上下"}
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
          onClick={() => seek(tauRef.current + STEP)}
          className="btn btn-ghost w-9 h-9 grid place-items-center"
          aria-label="1コマ進む"
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
          骨格 {showSkel ? "ON" : "OFF"}
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
              {name}
            </button>
          );
        })}
      </div>

      {/* Fine-tune offset */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--muted)" }}>
          <span>同期の微調整（後方を {offsetMs >= 0 ? "+" : ""}{offsetMs}ms ずらす）</span>
          {offsetMs !== 0 && (
            <button onClick={() => setOffsetMs(0)} style={{ color: "var(--green)" }}>
              リセット
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
        打音を基準に2本を整列。スライダーや◀▶で約{Math.round(STEP * 1000)}msずつ、正面・後方を同時に
        スロー再生・巻き戻しできます。骨格オーバーレイは端末内推定です。
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

function CrossReport({ result }: { result: CrossResult }) {
  return (
    <>
      <Card>
        <div className="text-sm font-bold mb-1">🔬 クロスアングル診断</div>
        <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
          正面と後方を組み合わせて初めて分かる「立体的なスイングエラー」の真因です。
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
                    正面
                  </span>
                  <span style={{ color: "var(--muted)" }}>{f.front.replace(/^正面[：:]\s*/, "")}</span>
                </div>
                <div className="flex gap-1.5">
                  <span className="font-bold shrink-0" style={{ color: "#22c55e" }}>
                    後方
                  </span>
                  <span style={{ color: "var(--muted)" }}>{f.dtl.replace(/^後方[：:]\s*/, "")}</span>
                </div>
                <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--line)" }}>
                  <span className="font-bold" style={{ color: "var(--fg)" }}>
                    真因 ▶︎{" "}
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
          計測値（アドレス→インパクト）
        </div>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="font-bold mb-1" style={{ color: "#22d3ee" }}>
              正面ビュー
            </div>
            <Row label="頭の上下動" value={`${result.front.headDropCm} cm`} />
            <Row label="腰の横移動" value={`${result.front.swayCm} cm`} />
          </div>
          <div>
            <div className="font-bold mb-1" style={{ color: "#22c55e" }}>
              後方ビュー
            </div>
            <Row
              label="前傾角の変化"
              value={`${result.dtl.spineDelta >= 0 ? "+" : ""}${result.dtl.spineDelta}°`}
            />
            <Row label="お尻の前後動" value={`${result.dtl.hipMoveCm} cm`} />
          </div>
        </div>
        <p className="text-[10px] mt-2" style={{ color: "var(--muted)" }}>
          ※ 2D骨格からの推定値です。被写体の大きさ・撮影角度で多少前後します。
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
