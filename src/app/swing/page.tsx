"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Spinner, SeverityBadge } from "@/components/ui";
import PhaseFigure from "@/components/PhaseFigure";
import { getPoseLandmarker, drawSkeleton, type Frame } from "@/lib/pose";
import { analyzeSwing, detectFaults, matchPro, syncRate, type SwingResult } from "@/lib/swing";
import { fetchPros, getProfile, saveSwing } from "@/lib/db";
import type { Pro, Profile, Fault, SwingAngles } from "@/lib/types";

type Stage = "idle" | "loading" | "ready" | "prep" | "recording" | "analyzing" | "done";

export default function SwingPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<Frame[]>([]);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef(false);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof getPoseLandmarker>> | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [countdown, setCountdown] = useState(0);
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
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
          const pose = res.landmarks?.[0];
          if (pose) {
            drawSkeleton(ctx, pose as Frame, canvas.width, canvas.height);
            if (recordingRef.current) framesRef.current.push(pose as Frame);
          }
        } catch {
          /* transient detect errors are fine */
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
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
    setStage("ready");
    startLoop();
    void ensureModel(); // load AI in the background — camera is already live
  }

  function switchCamera() {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    startCamera(next);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setStage("loading");
    try {
      stopAll();
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
      await video.play().catch(() => {});
      startLoop();
      framesRef.current = [];
      recordingRef.current = true;
      setStage("recording");
      video.onended = () => finishAnalysis();
    } catch (e) {
      setErr("動画を読み込めませんでした。別の動画ファイルでお試しください。");
      setStage("idle");
      console.error(e);
    }
  }

  function startRecording() {
    // Prep countdown so a solo user has time to get into the frame and address.
    setStage("prep");
    let prep = 3;
    setCountdown(prep);
    const pv = setInterval(() => {
      prep -= 1;
      setCountdown(prep);
      if (prep <= 0) {
        clearInterval(pv);
        beginCapture();
      }
    }, 1000);
  }

  function beginCapture() {
    framesRef.current = [];
    recordingRef.current = true;
    setStage("recording");
    let c = 5;
    setCountdown(c);
    const iv = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(iv);
        finishAnalysis();
      }
    }, 1000);
  }

  function finishAnalysis() {
    recordingRef.current = false;
    setStage("analyzing");
    const frames = framesRef.current;
    try {
      const detected = frames.length;
      const leftHanded = profile?.dominant_hand === "left";
      const r = analyzeSwing(frames, {
        heightCm: profile?.height_cm ?? undefined,
        leftHanded,
      });
      if (!r.valid) {
        setErr(
          detected === 0
            ? "骨格を検出できませんでした。全身（頭から足まで）がフレームに入るようカメラから2〜3m離れ、明るい場所で再撮影してください。"
            : "スイングをうまく解析できませんでした。全身が映る位置で、もう一度ゆっくりスイングしてみてください。",
        );
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
              {(stage === "ready" || stage === "prep") && (
                <button
                  onClick={switchCamera}
                  className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5"
                >
                  🔄 カメラ切替
                </button>
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
              {stage === "prep" && (
                <div className="absolute inset-0 grid place-items-center bg-black/30">
                  <div className="text-center">
                    <div className="text-6xl font-extrabold" style={{ color: "var(--green)" }}>
                      {countdown}
                    </div>
                    <div className="text-sm mt-1">構えてください</div>
                  </div>
                </div>
              )}
              {stage === "recording" && countdown > 0 && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-sm font-bold"
                  style={{ background: "var(--red)", color: "#fff" }}>
                  ● 撮影中 {countdown}
                </div>
              )}
              {stage === "analyzing" && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <Spinner label="解析中…" />
                </div>
              )}
            </div>
          </Card>

          {err && (
            <p className="text-xs mt-2" style={{ color: "var(--amber)" }}>
              {err}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 mt-3">
            {stage === "idle" || stage === "loading" ? (
              <>
                <button onClick={() => startCamera()} className="btn btn-primary py-3">
                  📷 カメラで撮影
                </button>
                <label className="btn btn-ghost py-3 text-center cursor-pointer">
                  🎞 動画を選択
                  <input type="file" accept="video/*" className="hidden" onChange={onFile} />
                </label>
              </>
            ) : stage === "ready" ? (
              <button
                onClick={() => (modelState === "error" ? ensureModel() : startRecording())}
                disabled={modelState === "loading"}
                className="btn btn-primary py-3 col-span-2 disabled:opacity-50"
              >
                {modelState === "ready"
                  ? "⏺ スイングを解析（3秒後に5秒間撮影）"
                  : modelState === "error"
                    ? "↻ AIエンジンを再読み込み"
                    : "AI解析エンジンを準備中…"}
              </button>
            ) : (
              <div className="col-span-2 text-center text-sm py-3" style={{ color: "var(--muted)" }}>
                {stage === "prep"
                  ? "構えてください…"
                  : stage === "recording"
                    ? "スイングしてください…"
                    : "解析中…"}
              </div>
            )}
          </div>
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
              setStage("ready");
              setResult(null);
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
