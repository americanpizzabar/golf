"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Spinner, SeverityBadge } from "@/components/ui";
import PhaseFigure from "@/components/PhaseFigure";
import { getPoseLandmarker, drawSkeleton, type Frame } from "@/lib/pose";
import { analyzeSwing, detectFaults, matchPro, syncRate, type SwingResult } from "@/lib/swing";
import { fetchPros, getProfile, saveSwing } from "@/lib/db";
import type { Pro, Profile, Fault, SwingAngles } from "@/lib/types";

type Stage = "idle" | "loading" | "ready" | "analyzing" | "done";

// Motion-energy thresholds (mean normalized joint displacement per frame) used
// by the continuous swing auto-detector. Tuned conservatively; the manual
// "今のスイングを解析" button is always available as a fallback.
const KEY_JOINTS = [15, 16, 11, 12, 23, 24]; // wrists, shoulders, hips
const E_QUIET = 0.006; // at/below ≈ standing still (address)
const E_BURST = 0.022; // above ≈ a real swing has started
const E_SETTLE = 0.009; // motion has calmed (finish)
const BUFFER_MS = 7000;

interface Stamped {
  lm: Frame;
  t: number;
}

export default function SwingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof getPoseLandmarker>> | null>(null);

  // Continuous rolling buffer + auto-detector state (all refs — the rAF loop
  // reschedules itself and must read the latest values without stale closures).
  const bufferRef = useRef<Stamped[]>([]);
  const uploadFramesRef = useRef<Frame[]>([]);
  const uploadingRef = useRef(false);
  const prevPoseRef = useRef<Frame | null>(null);
  const swingActiveRef = useRef(false);
  const windowStartRef = useRef(0);
  const peakTimeRef = useRef(0);
  const peakEnergyRef = useRef(0);
  const lastQuietRef = useRef(0);
  const analyzingRef = useRef(false);
  const stageRef = useRef<Stage>("idle");
  const autoRef = useRef(true);

  const [stage, setStage] = useState<Stage>("idle");
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [autoDetect, setAutoDetect] = useState(true);
  const [watch, setWatch] = useState("");
  const [pros, setPros] = useState<Pro[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pro, setPro] = useState<Pro | null>(null);
  const [result, setResult] = useState<SwingResult | null>(null);
  const [faults, setFaults] = useState<Fault[]>([]);
  const [sync, setSync] = useState(0);
  const [phaseFrames, setPhaseFrames] = useState<Record<string, Frame | null>>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  useEffect(() => {
    autoRef.current = autoDetect;
  }, [autoDetect]);

  useEffect(() => {
    (async () => {
      const [pr, p] = await Promise.all([fetchPros(), getProfile()]);
      setPros(pr);
      setProfile(p);
      const m = matchPro(pr, p ?? {});
      if (m) setPro(p?.matched_pro_id ? pr.find((x) => x.id === p.matched_pro_id) ?? m.pro : m.pro);
    })();
    return () => stopAll();
  }, []);

  function stopAll() {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function resetDetector() {
    bufferRef.current = [];
    prevPoseRef.current = null;
    swingActiveRef.current = false;
    windowStartRef.current = 0;
    peakTimeRef.current = 0;
    peakEnergyRef.current = 0;
    lastQuietRef.current = 0;
    analyzingRef.current = false;
  }

  // Mean displacement of key joints between two poses (motion energy).
  function motionEnergy(a: Frame, b: Frame): number {
    let sum = 0;
    let n = 0;
    for (const i of KEY_JOINTS) {
      const pa = a[i];
      const pb = b[i];
      if (!pa || !pb) continue;
      sum += Math.hypot(pa.x - pb.x, pa.y - pb.y);
      n++;
    }
    return n ? sum / n : 0;
  }

  // Load the MediaPipe model once. Never blocks the camera; if it fails the
  // camera still works and we surface a retry-able message.
  async function ensureModel() {
    if (landmarkerRef.current) return landmarkerRef.current;
    setModelState("loading");
    try {
      const lm = await getPoseLandmarker();
      landmarkerRef.current = lm;
      setModelState("ready");
      setErr("");
      return lm;
    } catch (e) {
      console.error("pose model load failed", e);
      setModelState("error");
      setErr("AI解析エンジンの読み込みに失敗しました。通信環境を確認して再試行してください。");
      return null;
    }
  }

  function startLoop() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }

  function loop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2 && video.videoWidth) {
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const ctx = canvas.getContext("2d");
      const lm = landmarkerRef.current;
      if (ctx && lm) {
        try {
          const ts = Math.max(performance.now(), lastTsRef.current + 1);
          lastTsRef.current = ts;
          const res = lm.detectForVideo(video, ts);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const pose = res.landmarks?.[0] as Frame | undefined;
          if (pose) {
            drawSkeleton(ctx, pose, canvas.width, canvas.height);
            if (uploadingRef.current) {
              uploadFramesRef.current.push(pose);
            } else {
              // Maintain rolling buffer and run the continuous detector.
              bufferRef.current.push({ lm: pose, t: ts });
              const cutoff = ts - BUFFER_MS;
              while (bufferRef.current.length && bufferRef.current[0].t < cutoff) {
                bufferRef.current.shift();
              }
              if (autoRef.current && stageRef.current === "ready" && !analyzingRef.current) {
                runDetector(pose, ts);
              }
            }
          }
        } catch {
          /* transient detect errors are fine */
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }

  // 常時監視：アドレス（静止）→始動→インパクト→フィニッシュを自動検知し、
  // スイングシーンだけを切り出す。時間制限は一切なし。
  function runDetector(pose: Frame, t: number) {
    const prev = prevPoseRef.current;
    prevPoseRef.current = pose;
    if (!prev) return;
    const energy = motionEnergy(pose, prev);
    if (energy < E_QUIET) lastQuietRef.current = t;

    if (!swingActiveRef.current) {
      // Trigger only when a burst follows a recent quiet (address) period.
      const wasRecentlyQuiet = lastQuietRef.current > 0 && t - lastQuietRef.current < 1500;
      if (energy > E_BURST && wasRecentlyQuiet) {
        swingActiveRef.current = true;
        windowStartRef.current = lastQuietRef.current - 300; // include address
        peakTimeRef.current = t;
        peakEnergyRef.current = energy;
        setWatch("スイングを検出！");
      } else if (wasRecentlyQuiet) {
        setWatch("構えを検出 — スイングをどうぞ");
      } else {
        setWatch("待機中（自動検出ON）");
      }
    } else {
      if (energy > peakEnergyRef.current) {
        peakEnergyRef.current = energy;
        peakTimeRef.current = t;
      }
      const settled = energy < E_SETTLE && t - peakTimeRef.current > 300;
      const tooLong = t - windowStartRef.current > 3500;
      if (settled || tooLong) {
        swingActiveRef.current = false;
        const frames = bufferRef.current
          .filter((b) => b.t >= windowStartRef.current && b.t <= peakTimeRef.current + 800)
          .map((b) => b.lm);
        if (frames.length >= 8) {
          const span = bufferRef.current.filter(
            (b) => b.t >= windowStartRef.current && b.t <= peakTimeRef.current + 800,
          );
          const durSec = (span[span.length - 1].t - span[0].t) / 1000;
          const fps = durSec > 0 ? frames.length / durSec : 30;
          finishAnalysis(frames, fps);
        } else {
          // False trigger — keep watching.
          setWatch("待機中（自動検出ON）");
        }
      }
    }
  }

  function cameraErrorMessage(e: unknown): string {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError")
      return "カメラの使用が許可されませんでした。ブラウザのアドレスバーからカメラを「許可」に変更してください。";
    if (name === "NotFoundError" || name === "OverconstrainedError")
      return "利用できるカメラが見つかりませんでした。動画アップロードをご利用ください。";
    if (name === "NotReadableError")
      return "カメラが他のアプリで使用中の可能性があります。他のアプリを閉じて再試行してください。";
    return "カメラを起動できませんでした。権限を確認するか、動画アップロードをお試しください。";
  }

  async function startCamera(facingOverride?: "environment" | "user") {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。動画アップロードをご利用ください。");
      return;
    }
    const want = facingOverride ?? facing;
    // Stop any existing stream first (needed when switching cameras).
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStage("loading");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: want }, width: { ideal: 720 } },
        audio: false,
      });
    } catch {
      // Fallback: some devices have no camera matching the requested facing.
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e2) {
        setErr(cameraErrorMessage(e2));
        setStage("idle");
        return;
      }
    }
    streamRef.current = stream;
    const video = videoRef.current!;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    try {
      await video.play();
    } catch {
      /* play() can reject under autoplay policy; loop guards on readyState */
    }
    resetDetector();
    uploadingRef.current = false;
    setWatch("待機中（自動検出ON）");
    setStage("ready");
    startLoop();
    void ensureModel(); // load AI in the background — camera is already live
  }

  function switchCamera() {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    startCamera(next);
  }

  // Manual fallback: analyze whatever swing is in the last ~5s rolling buffer.
  function manualAnalyze() {
    const now = lastTsRef.current || performance.now();
    const span = bufferRef.current.filter((b) => b.t >= now - 5000);
    const frames = span.map((b) => b.lm);
    const durSec = span.length > 1 ? (span[span.length - 1].t - span[0].t) / 1000 : 1;
    const fps = durSec > 0 ? frames.length / durSec : 30;
    finishAnalysis(frames, fps);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setStage("loading");
    try {
      stopAll();
      resetDetector();
      const video = videoRef.current!;
      video.srcObject = null;
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      // For a file we can wait for the model so the whole clip is analyzed.
      const lm = await ensureModel();
      if (!lm) {
        setStage("idle");
        return;
      }
      uploadFramesRef.current = [];
      uploadingRef.current = true;
      await video.play().catch(() => {});
      startLoop();
      setStage("analyzing");
      setWatch("");
      video.onended = () => {
        uploadingRef.current = false;
        const frames = uploadFramesRef.current;
        // Assume ~30fps for an arbitrary uploaded clip.
        finishAnalysis(frames, 30);
      };
    } catch (e) {
      setErr("動画を読み込めませんでした。別の動画ファイルでお試しください。");
      setStage("idle");
      console.error(e);
    }
  }

  function finishAnalysis(frames: Frame[], fps: number) {
    analyzingRef.current = true;
    stageRef.current = "analyzing";
    setStage("analyzing");
    try {
      const detected = frames.length;
      const leftHanded = profile?.dominant_hand === "left";
      const r = analyzeSwing(frames, {
        heightCm: profile?.height_cm ?? undefined,
        leftHanded,
        fps,
      });
      if (!r.valid) {
        setErr(
          detected === 0
            ? "骨格を検出できませんでした。全身（頭から足まで）がフレームに入るようカメラから2〜3m離れ、明るい場所で再撮影してください。"
            : "スイングをうまく解析できませんでした。全身が映る位置で、もう一度ゆっくりスイングしてみてください。",
        );
        // Re-arm the continuous detector and keep watching.
        resetDetector();
        stageRef.current = "ready";
        setStage("ready");
        return;
      }
      const f = detectFaults(r, pro);
      const bodySync = matchPro(pros, profile ?? {})?.sync ?? 70;
      const s = syncRate(bodySync, r, pro);
      setResult(r);
      setFaults(f);
      setSync(s);
      setPhaseFrames({
        address: frames[r.phaseIdx.address] ?? null,
        top: frames[r.phaseIdx.top] ?? null,
        impact: frames[r.phaseIdx.impact] ?? null,
        finish: frames[r.phaseIdx.finish] ?? null,
      });
      setSaved(false);
      setStage("done");
    } catch (e) {
      console.error("swing analysis failed", e);
      setErr("解析中に問題が発生しました。もう一度お試しください。");
      resetDetector();
      stageRef.current = "ready";
      setStage("ready");
    }
  }

  async function save() {
    if (!result) return;
    await saveSwing({
      sync_rate: sync,
      matched_pro_id: pro?.id ?? null,
      plane_deg: result.swingPlane,
      tempo_ratio: result.tempoRatio,
      spine_tilt_deg: result.spineTilt,
      hip_turn_deg: result.hipTurn,
      shoulder_turn_deg: result.shoulderTurn,
      faults,
      angles: result.angles as SwingAngles,
      thumbnail: null,
      note: null,
    });
    setSaved(true);
  }

  const showCamera = stage !== "done";

  return (
    <main>
      <PageHeader title="スイングAI解析" subtitle="骨格をリアルタイム計測・プロと比較" back />

      <div className="px-4 space-y-4">
        {!profile?.height_cm && (
          <Link href="/profile" className="card p-3 text-sm block">
            ⚠️ 先に<span style={{ color: "var(--green)" }}>体型プロフィール</span>を登録すると、あなたに最適なプロと比較できます（未登録時は標準体型で比較）。
          </Link>
        )}

        {/* Camera / video stage */}
        <div className={showCamera ? "block" : "hidden"}>
          <Card className="p-0 overflow-hidden">
            <div className="relative bg-black aspect-[3/4]">
              <video
                ref={videoRef}
                playsInline
                autoPlay
                muted
                className="absolute inset-0 w-full h-full object-contain"
                style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
              />
              {stage === "ready" && (
                <button
                  onClick={switchCamera}
                  className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5"
                >
                  🔄 カメラ切替
                </button>
              )}
              {stage === "ready" && autoDetect && modelState === "ready" && watch && (
                <div
                  className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                  style={{
                    background: swingActiveRef.current ? "var(--red)" : "rgba(0,0,0,0.6)",
                    color: "#fff",
                  }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: swingActiveRef.current ? "#fff" : "var(--green)" }}
                  />
                  {watch}
                </div>
              )}
              {stage === "idle" && (
                <div className="absolute inset-0 grid place-items-center text-center px-6">
                  <div>
                    <div className="text-4xl mb-2">🏌️</div>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      全身が映るようにスマホを縦に置き、<br />正面または後方から撮影します
                    </p>
                  </div>
                </div>
              )}
              {stage === "loading" && (
                <div className="absolute inset-0 grid place-items-center">
                  <Spinner label="カメラを起動中…" />
                </div>
              )}
              {modelState === "loading" && stage !== "loading" && stage !== "idle" && (
                <div
                  className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5"
                  style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}
                >
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  AI解析エンジン準備中…
                </div>
              )}
              {stage === "analyzing" && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <Spinner label="スイングを解析中…" />
                </div>
              )}
            </div>
          </Card>

          {err && (
            <p className="text-xs mt-2" style={{ color: "var(--amber)" }}>
              {err}
            </p>
          )}

          {stage === "idle" || stage === "loading" ? (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => startCamera()} className="btn btn-primary py-3">
                📷 カメラで撮影
              </button>
              <label className="btn btn-ghost py-3 text-center cursor-pointer">
                🎞 動画を選択
                <input type="file" accept="video/*" className="hidden" onChange={onFile} />
              </label>
            </div>
          ) : stage === "ready" ? (
            <div className="mt-3 space-y-2">
              {modelState === "error" ? (
                <button onClick={() => ensureModel()} className="btn btn-primary py-3 w-full">
                  ↻ AIエンジンを再読み込み
                </button>
              ) : modelState !== "ready" ? (
                <div className="text-center text-sm py-3" style={{ color: "var(--muted)" }}>
                  AI解析エンジンを準備中…
                </div>
              ) : (
                <>
                  <div
                    className="card px-3 py-2.5 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold">自動スイング検出</div>
                      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                        時間制限なし。構えてからゆっくり打ってOK
                      </div>
                    </div>
                    <button
                      onClick={() => setAutoDetect((v) => !v)}
                      className="btn px-3 py-1.5 text-xs"
                      style={{
                        background: autoDetect ? "var(--green)" : "var(--bg-soft)",
                        color: autoDetect ? "#03260f" : "var(--fg)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {autoDetect ? "ON" : "OFF"}
                    </button>
                  </div>
                  <button onClick={manualAnalyze} className="btn btn-ghost py-3 w-full">
                    ⏱ 今のスイングを解析（手動）
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Result */}
        {stage === "done" && result && (
          <Results
            result={result}
            faults={faults}
            sync={sync}
            pro={pro}
            phaseFrames={phaseFrames}
            saved={saved}
            onSave={save}
            onRetry={() => {
              resetDetector();
              setWatch("待機中（自動検出ON）");
              stageRef.current = "ready";
              setResult(null);
              setStage("ready");
            }}
          />
        )}
      </div>
    </main>
  );
}

function Results({
  result,
  faults,
  sync,
  pro,
  phaseFrames,
  saved,
  onSave,
  onRetry,
}: {
  result: SwingResult;
  faults: Fault[];
  sync: number;
  pro: Pro | null;
  phaseFrames: Record<string, Frame | null>;
  saved: boolean;
  onSave: () => void;
  onRetry: () => void;
}) {
  const phases: [string, string][] = [
    ["address", "アドレス"],
    ["top", "トップ"],
    ["impact", "インパクト"],
    ["finish", "フィニッシュ"],
  ];

  return (
    <>
      {/* Sync gauge */}
      <Card className="text-center">
        <div className="text-xs" style={{ color: "var(--muted)" }}>
          {pro ? `${pro.name} とのシンクロ率` : "スイング完成度"}
        </div>
        <div className="text-5xl font-extrabold mt-1" style={{ color: "var(--cyan)" }}>
          {sync}
          <span className="text-2xl">%</span>
        </div>
        <div className="h-2 rounded-full mt-3" style={{ background: "var(--line)" }}>
          <div className="h-full rounded-full" style={{ width: `${sync}%`, background: "var(--cyan)" }} />
        </div>
      </Card>

      {/* 3D wireframe phases */}
      <Card>
        <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          3Dワイヤーフレーム（4ポジション）
        </div>
        <div className="grid grid-cols-4 gap-2">
          {phases.map(([key, label]) => (
            <PhaseFigure key={key} frame={phaseFrames[key] ?? null} label={label} size={72} />
          ))}
        </div>
      </Card>

      {/* Plane compare */}
      {pro && (
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            スイングプレーン比較
          </div>
          <PlaneCompare user={result.swingPlane} proDeg={pro.swing_plane_deg} accent={pro.accent} />
          <div className="grid grid-cols-2 gap-2 mt-3 text-center">
            <Metric label="あなた" value={`${result.swingPlane}°`} color="var(--cyan)" />
            <Metric label={pro.name} value={`${pro.swing_plane_deg}°`} color={pro.accent} />
          </div>
        </Card>
      )}

      {/* Metrics grid */}
      <Card>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <KV k="肩の回転 (トップ)" v={`${result.shoulderTurn}°`} ref_={pro?.shoulder_turn_deg} unit="°" />
          <KV k="腰の回転 (トップ)" v={`${result.hipTurn}°`} ref_={pro?.hip_turn_deg} unit="°" />
          <KV k="前傾(背骨)角" v={`${result.spineTilt}°`} ref_={pro?.spine_tilt_deg} unit="°" />
          <KV k="テンポ比" v={`${result.tempoRatio}`} ref_={pro?.tempo_ratio} unit="" />
          <KV k="軸の横ブレ" v={`${result.swayCm}cm`} />
          <KV k="リード腕(インパクト)" v={`${result.leadArmImpact}°`} />
        </div>
      </Card>

      {/* Faults */}
      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          一言原因究明（{faults.length}件）
        </div>
        {faults.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--green)" }}>
            ✓ 大きな悪癖は検出されませんでした。ナイススイング！
          </p>
        ) : (
          <div className="space-y-2">
            {faults.map((f, i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: "var(--bg-soft)" }}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{f.label}</span>
                  <SeverityBadge severity={f.severity} />
                  <span className="ml-auto text-xs font-mono" style={{ color: "var(--amber)" }}>
                    {f.cm != null ? `${f.cm}cm` : f.deg != null ? `${f.deg}°` : ""}
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {f.detail}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ① リバース・エンジニアリング（巻き戻し）診断 */}
      {result.rootCause.length > 1 && (
        <Card>
          <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>
            🔎 リバース・エンジニアリング診断（根本原因の巻き戻し）
          </div>
          <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
            結果から時間を遡り、悪癖の引き金になった最初の動きを特定します。
          </p>
          <div className="space-y-0">
            {result.rootCause.map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className="w-3 h-3 rounded-full mt-1"
                    style={{ background: i === result.rootCause.length - 1 ? "var(--red)" : "var(--cyan)" }}
                  />
                  {i < result.rootCause.length - 1 && (
                    <div className="w-0.5 flex-1 my-1" style={{ background: "var(--line)" }} />
                  )}
                </div>
                <div className="pb-3">
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                    {s.phase}
                    {s.tMs !== 0 && `（インパクト${s.tMs}ms）`}
                    {i === result.rootCause.length - 1 && " ← 根本原因"}
                  </div>
                  <div className="text-sm font-semibold">{s.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                    {s.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onRetry} className="btn btn-ghost py-3">
          もう一度
        </button>
        <button onClick={onSave} className="btn btn-primary py-3">
          {saved ? "保存しました ✓" : "記録を保存"}
        </button>
      </div>
      {faults.length > 0 && (
        <Link href="/coach" className="btn btn-ghost py-3 block text-center">
          🧠 この診断から練習メニューを作る
        </Link>
      )}
    </>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function KV({ k, v, ref_, unit }: { k: string; v: string; ref_?: number; unit?: string }) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
        {k}
      </div>
      <div className="font-semibold">
        {v}
        {ref_ != null && (
          <span className="text-[11px] ml-1" style={{ color: "var(--muted)" }}>
            / 理想 {ref_}
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function PlaneCompare({ user, proDeg, accent }: { user: number; proDeg: number; accent: string }) {
  const W = 280,
    H = 120,
    cx = 40,
    cy = H - 12;
  const len = 220;
  const line = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * len, y: cy - Math.sin(rad) * len };
  };
  const u = line(user);
  const p = line(proDeg);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={cx} y1={cy} x2={W - 10} y2={cy} stroke="var(--line)" strokeWidth={1} />
      <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={accent} strokeWidth={3} strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={u.x} y2={u.y} stroke="var(--cyan)" strokeWidth={3} strokeDasharray="6 4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={4} fill="#fff" />
    </svg>
  );
}
