"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Spinner, SeverityBadge } from "@/components/ui";
import PhaseFigure from "@/components/PhaseFigure";
import { getPoseLandmarker, drawSkeleton, type Frame } from "@/lib/pose";
import { analyzeSwing, detectFaults, matchPro, syncRate, compactFrames, type SwingResult } from "@/lib/swing";
import { CLUBS, clubFactor } from "@/lib/golf";
import { fetchPros, getProfile, saveSwing } from "@/lib/db";
import type { Pro, Profile, Fault, SwingAngles } from "@/lib/types";

type Stage = "idle" | "loading" | "ready" | "trim" | "analyzing" | "done";

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
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const landmarkerRef = useRef<Awaited<ReturnType<typeof getPoseLandmarker>> | null>(null);

  // Continuous rolling buffer + auto-detector state (all refs — the rAF loop
  // reschedules itself and must read the latest values without stale closures).
  const bufferRef = useRef<Stamped[]>([]);
  const uploadFramesRef = useRef<Stamped[]>([]);
  const uploadingRef = useRef(false);
  const manualRecRef = useRef(false);
  const manualFramesRef = useRef<Stamped[]>([]);
  const prevPoseRef = useRef<Frame | null>(null);
  const swingActiveRef = useRef(false);
  const windowStartRef = useRef(0);
  const peakTimeRef = useRef(0);
  const peakEnergyRef = useRef(0);
  const lastQuietRef = useRef(0);
  const analyzingRef = useRef(false);
  const stageRef = useRef<Stage>("idle");
  const autoRef = useRef(true);
  const lastFramesRef = useRef<Frame[]>([]);

  const [stage, setStage] = useState<Stage>("idle");
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [autoDetect, setAutoDetect] = useState(true);
  const [manualRec, setManualRec] = useState(false);
  const [watch, setWatch] = useState("");
  const [notice, setNotice] = useState("");
  const [zoom, setZoom] = useState(1);
  const [hasNativeZoom, setHasNativeZoom] = useState(false);
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [club, setClub] = useState("7I");
  const [uploadDur, setUploadDur] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [scanPct, setScanPct] = useState(0);
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
              // Use the clip's own time so the swing can be cropped accurately.
              uploadFramesRef.current.push({ lm: pose, t: video.currentTime * 1000 });
            } else if (manualRecRef.current) {
              // Manual record (auto-detect OFF): collect everything start→stop.
              manualFramesRef.current.push({ lm: pose, t: ts });
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

  async function startCamera(opts?: { facing?: "environment" | "user"; deviceId?: string }) {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。動画アップロードをご利用ください。");
      return;
    }
    const want = opts?.facing ?? facing;
    // Stop any existing stream first (needed when switching cameras / lenses).
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStage("loading");
    const videoConstraint: MediaTrackConstraints = opts?.deviceId
      ? { deviceId: { exact: opts.deviceId }, width: { ideal: 1280 } }
      : { facingMode: { ideal: want }, width: { ideal: 1280 } };
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
    } catch {
      // Fallback: some devices have no camera matching the requested facing/lens.
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

    // Inspect the track for native zoom (optical/sensor) capability and enumerate lenses.
    const track = stream.getVideoTracks()[0] ?? null;
    trackRef.current = track;
    setDeviceId(track?.getSettings().deviceId ?? opts?.deviceId ?? "");
    setupZoom(track);
    enumerateLenses();

    resetDetector();
    uploadingRef.current = false;
    setNotice("");
    setWatch("待機中（自動検出ON）");
    setStage("ready");
    startLoop();
    void ensureModel(); // load AI in the background — camera is already live
  }

  // `zoom` is a non-standard (but widely shipped) capability not in the DOM types.
  function zoomCapability(track: MediaStreamTrack | null) {
    if (!track?.getCapabilities) return undefined;
    const caps = track.getCapabilities() as unknown as {
      zoom?: { min: number; max: number; step?: number };
    };
    return caps.zoom;
  }

  function setupZoom(track: MediaStreamTrack | null) {
    setZoom(1);
    const z = zoomCapability(track);
    if (z && z.max > z.min) {
      setHasNativeZoom(true);
      setZoomCaps({ min: z.min, max: z.max, step: z.step || 0.1 });
      const cur = (track?.getSettings() as unknown as { zoom?: number })?.zoom;
      if (cur) setZoom(cur);
    } else {
      // No native zoom → CSS digital zoom (display only) up to 3x.
      setHasNativeZoom(false);
      setZoomCaps({ min: 1, max: 3, step: 0.1 });
    }
  }

  function applyZoom(z: number) {
    setZoom(z);
    const track = trackRef.current;
    if (track && zoomCapability(track)) {
      track
        .applyConstraints({ advanced: [{ zoom: z } as unknown as MediaTrackConstraintSet] })
        .catch(() => {});
    }
    // else: handled by CSS transform on the video/canvas (digital zoom)
  }

  async function enumerateLenses() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "videoinput"));
    } catch {
      /* ignore */
    }
  }

  function switchCamera() {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    startCamera({ facing: next });
  }

  // Manual capture (auto-detect OFF): explicit start → stop, no time limit.
  function startManual() {
    manualFramesRef.current = [];
    manualRecRef.current = true;
    setManualRec(true);
    setNotice("");
    setWatch("記録中… スイングしてください");
  }
  function stopManual() {
    manualRecRef.current = false;
    setManualRec(false);
    const span = manualFramesRef.current;
    const frames = span.map((b) => b.lm);
    const durSec = span.length > 1 ? (span[span.length - 1].t - span[0].t) / 1000 : 1;
    const fps = durSec > 0 ? frames.length / durSec : 30;
    finishAnalysis(frames, fps);
  }

  // Load an uploaded clip and enter the trim screen (the user selects exactly
  // the swing portion). Realtime sampling dropped fast frames, so this defers
  // to a deterministic frame-stepping scan of the chosen range.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setNotice("");
    setStage("loading");
    try {
      stopAll();
      resetDetector();
      uploadingRef.current = false;
      const video = videoRef.current!;
      video.srcObject = null;
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      const lm = await ensureModel();
      if (!lm) {
        setStage("idle");
        return;
      }
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1 && video.duration) return resolve();
        video.onloadedmetadata = () => resolve();
      });
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      setUploadDur(dur);
      setTrimStart(0);
      setTrimEnd(dur);
      try {
        video.pause();
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      setStage("trim");
    } catch (e) {
      setErr("動画を読み込めませんでした。別の動画ファイルでお試しください。");
      setStage("idle");
      console.error(e);
    }
  }

  // Seek the upload preview to a time (used when dragging the trim handles).
  function seekPreview(t: number) {
    const video = videoRef.current;
    if (video) {
      try {
        video.currentTime = Math.min(Math.max(0, t), uploadDur || t);
      } catch {
        /* ignore */
      }
    }
  }

  // Deterministically step through the selected range frame-by-frame (via
  // seeking) so the impact frame is never missed, regardless of device speed.
  async function scanRange() {
    const video = videoRef.current;
    const model = landmarkerRef.current ?? (await ensureModel());
    if (!video || !model) return;
    const start = trimStart;
    const end = Math.max(trimStart + 0.2, trimEnd);
    const range = end - start;
    const step = Math.max(1 / 30, range / 120); // ≤120 samples
    analyzingRef.current = true;
    stageRef.current = "analyzing";
    setStage("analyzing");
    setNotice("");
    setScanPct(0);
    video.pause();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    const seekTo = (t: number) =>
      new Promise<void>((resolve) => {
        const onSeek = () => {
          video.removeEventListener("seeked", onSeek);
          resolve();
        };
        video.addEventListener("seeked", onSeek);
        try {
          video.currentTime = t;
        } catch {
          resolve();
        }
      });

    const frames: Frame[] = [];
    let ts = (lastTsRef.current || 0) + 1;
    const total = Math.max(1, Math.ceil(range / step));
    let i = 0;
    for (let t = start; t <= end + 1e-6; t += step) {
      await seekTo(Math.min(t, video.duration || end));
      try {
        ts += 1;
        const res = model.detectForVideo(video, ts);
        const pose = res.landmarks?.[0] as Frame | undefined;
        if (pose) {
          frames.push(pose);
          if (ctx && canvas) {
            if (canvas.width !== video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawSkeleton(ctx, pose, canvas.width, canvas.height);
          }
        }
      } catch {
        /* skip bad frame */
      }
      i += 1;
      setScanPct(Math.round((i / total) * 100));
    }
    lastTsRef.current = ts;
    const fps = range > 0 ? frames.length / range : 30;
    if (frames.length < 6) {
      setErr("選択範囲で骨格を検出できませんでした。全身が映る範囲を選び直してください。");
      analyzingRef.current = false;
      stageRef.current = "trim";
      setStage("trim");
      return;
    }
    setNotice(`選択範囲 ${start.toFixed(1)}〜${end.toFixed(1)}秒（${frames.length}コマ）を解析`);
    finishAnalysis(frames, fps, "trim");
  }

  function finishAnalysis(frames: Frame[], fps: number, backStage: Stage = "ready") {
    analyzingRef.current = true;
    stageRef.current = "analyzing";
    lastFramesRef.current = frames;
    setStage("analyzing");
    try {
      const detected = frames.length;
      const leftHanded = profile?.dominant_hand === "left";
      const r = analyzeSwing(frames, {
        heightCm: profile?.height_cm ?? undefined,
        leftHanded,
        fps,
        clubFactor: clubFactor(club),
      });
      if (!r.valid) {
        setErr(
          detected === 0
            ? "骨格を検出できませんでした。全身（頭から足まで）がフレームに入るようカメラから2〜3m離れ、明るい場所で再撮影してください。"
            : "スイングをうまく解析できませんでした。全身が映る位置で、もう一度ゆっくりスイングしてみてください。",
        );
        // Re-arm the continuous detector / return to the trim screen.
        resetDetector();
        stageRef.current = backStage;
        setStage(backStage);
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
      stageRef.current = backStage;
      setStage(backStage);
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
      club,
      head_speed: result.headSpeed,
      hand_speed: result.handSpeed,
      efficiency: result.efficiency,
      apex_m: null,
      pose_frames: compactFrames(lastFramesRef.current),
    });
    setSaved(true);
  }

  const showCamera = stage !== "done";
  // Mirror the front camera; apply CSS digital zoom only when the device has no
  // native (optical/sensor) zoom.
  const digitalZoom = !hasNativeZoom && zoom > 1 ? ` scale(${zoom})` : "";
  const cameraTransform = `${facing === "user" ? "scaleX(-1)" : ""}${digitalZoom}` || undefined;
  const swingHot = manualRec || watch.includes("検出");
  const backLenses = devices.filter(
    (d) => !/front|user|前面/i.test(d.label) || devices.length <= 2,
  );

  return (
    <main>
      <PageHeader title="スイングAI解析" subtitle="骨格をリアルタイム計測・プロと比較" back />

      <div className="px-4 space-y-4">
        {!profile?.height_cm && (
          <Link href="/profile" className="card p-3 text-sm block">
            ⚠️ 先に<span style={{ color: "var(--green)" }}>体型プロフィール</span>を登録すると、あなたに最適なプロと比較できます（未登録時は標準体型で比較）。
          </Link>
        )}

        {showCamera && (
          <div className="flex items-center gap-2">
            <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>使用クラブ</span>
            <select value={club} onChange={(e) => setClub(e.target.value)} className="flex-1 px-2 py-2 text-sm">
              {CLUBS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
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
                style={{ transform: cameraTransform }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ transform: cameraTransform }}
              />
              {stage === "ready" && (
                <button
                  onClick={switchCamera}
                  className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5"
                >
                  🔄 前後切替
                </button>
              )}
              {stage === "ready" && modelState === "ready" && watch && (autoDetect || manualRec) && (
                <div
                  className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5"
                  style={{
                    background: swingHot ? "var(--red)" : "rgba(0,0,0,0.6)",
                    color: "#fff",
                  }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: swingHot ? "#fff" : "var(--green)" }}
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
                  <div className="text-center">
                    <Spinner label={scanPct > 0 ? `スキャン中… ${scanPct}%` : "スイングを解析中…"} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Video trim: choose exactly the swing portion */}
          {stage === "trim" && (
            <div className="mt-3 space-y-3">
              <Card>
                <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                  解析するスイングの範囲を指定（不要な素振り・歩行を除外すると精度が上がります）
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
                      <span>開始: {trimStart.toFixed(1)}秒</span>
                      <button onClick={() => seekPreview(trimStart)} className="underline" style={{ color: "var(--green)" }}>
                        この位置を表示
                      </button>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={uploadDur || 0}
                      step={0.1}
                      value={trimStart}
                      onChange={(e) => {
                        const v = Math.min(Number(e.target.value), trimEnd - 0.2);
                        setTrimStart(v);
                        seekPreview(v);
                      }}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
                      <span>終了: {trimEnd.toFixed(1)}秒</span>
                      <button onClick={() => seekPreview(trimEnd)} className="underline" style={{ color: "var(--green)" }}>
                        この位置を表示
                      </button>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={uploadDur || 0}
                      step={0.1}
                      value={trimEnd}
                      onChange={(e) => {
                        const v = Math.max(Number(e.target.value), trimStart + 0.2);
                        setTrimEnd(v);
                        seekPreview(v);
                      }}
                      className="w-full"
                    />
                  </div>
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                    選択範囲 {(trimEnd - trimStart).toFixed(1)}秒（アドレス〜フィニッシュが収まる長さが目安）
                  </div>
                </div>
              </Card>
              <div className="grid grid-cols-2 gap-2">
                <label className="btn btn-ghost py-3 text-center cursor-pointer">
                  別の動画
                  <input type="file" accept="video/*" className="hidden" onChange={onFile} />
                </label>
                <button onClick={scanRange} className="btn btn-primary py-3">
                  ✂ この範囲を解析
                </button>
              </div>
            </div>
          )}

          {/* Lens + zoom controls (live camera only) */}
          {stage === "ready" && (
            <div className="mt-3 space-y-2">
              {devices.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>レンズ</span>
                  <select
                    value={deviceId}
                    onChange={(e) => startCamera({ deviceId: e.target.value })}
                    className="flex-1 px-2 py-2 text-sm"
                  >
                    {backLenses.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `カメラ ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {zoomCaps && (
                <div className="flex items-center gap-2">
                  <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>
                    {zoomCaps.min < 1 ? "広角" : "ズーム"}
                  </span>
                  <button
                    onClick={() => applyZoom(Math.max(zoomCaps.min, Math.round((zoom - (zoomCaps.step > 0.2 ? zoomCaps.step : 0.2)) * 10) / 10))}
                    className="btn btn-ghost px-3 py-1.5 text-sm"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={zoomCaps.min}
                    max={zoomCaps.max}
                    step={zoomCaps.step}
                    value={zoom}
                    onChange={(e) => applyZoom(Number(e.target.value))}
                    className="flex-1"
                  />
                  <button
                    onClick={() => applyZoom(Math.min(zoomCaps.max, Math.round((zoom + (zoomCaps.step > 0.2 ? zoomCaps.step : 0.2)) * 10) / 10))}
                    className="btn btn-ghost px-3 py-1.5 text-sm"
                  >
                    ＋
                  </button>
                  <span className="text-xs w-10 text-right" style={{ color: "var(--cyan)" }}>
                    {zoom.toFixed(1)}×
                  </span>
                </div>
              )}
            </div>
          )}

          {err && (
            <p className="text-xs mt-2" style={{ color: "var(--amber)" }}>
              {err}
            </p>
          )}
          {notice && (
            <p className="text-xs mt-2" style={{ color: "var(--cyan)" }}>
              {notice}
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
                  <div className="card px-3 py-2.5 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">自動スイング検出</div>
                      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                        時間制限なし。構えてからゆっくり打ってOK
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (manualRec) return; // don't toggle mid-recording
                        setAutoDetect((v) => !v);
                      }}
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
                  {!autoDetect &&
                    (manualRec ? (
                      <button
                        onClick={stopManual}
                        className="btn py-3.5 w-full font-bold"
                        style={{ background: "var(--red)", color: "#fff" }}
                      >
                        ■ 終了して解析
                      </button>
                    ) : (
                      <button onClick={startManual} className="btn btn-primary py-3.5 w-full">
                        ● 検知開始（手動）
                      </button>
                    ))}
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

      {/* Virtual head speed / efficiency */}
      {result.headSpeed > 0 && (
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            バーチャル・ヘッドスピード（骨格＋映像から推定）
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>推定ヘッドスピード</div>
              <div className="font-bold text-xl" style={{ color: "var(--cyan)" }}>
                {result.headSpeed}<span className="text-xs">m/s</span>
              </div>
            </div>
            <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>手元スピード</div>
              <div className="font-bold text-xl">
                {result.handSpeed}<span className="text-xs">m/s</span>
              </div>
            </div>
            <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>効率（タメ）</div>
              <div
                className="font-bold text-xl"
                style={{ color: result.efficiency >= 60 ? "var(--green)" : "var(--amber)" }}
              >
                {result.efficiency}
              </div>
            </div>
          </div>
          <p className="text-[11px] mt-2" style={{ color: "var(--muted)" }}>
            {result.efficiency >= 60
              ? "タメが解けて効率よく加速できています（手元の減速→ヘッドが走る）。"
              : "手元が走り続け＝手打ち傾向。下半身リードでタメを保ちましょう。"}
            {" "}※ クラブ非検出のため映像と骨格からの推定値です。
          </p>
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
