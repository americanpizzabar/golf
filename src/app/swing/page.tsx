"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Spinner, SeverityBadge } from "@/components/ui";
import PhaseFigure from "@/components/PhaseFigure";
import { getPoseLandmarker, drawSkeleton, LM, type Frame } from "@/lib/pose";
import { analyzeSwing, detectFaults, matchPro, syncRate, compactFrames, type SwingResult } from "@/lib/swing";
import { ANGLE_LABEL, type ViewAngle } from "@/lib/ghost-sync";
import { CLUBS, clubFactor } from "@/lib/golf";
import { fetchPros, getProfile, saveSwing } from "@/lib/db";
import { useT } from "@/lib/i18n";
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
  const t = useT();
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
  const angleEmaRef = useRef(0); // smoothed shoulderW/torso ratio
  const liveAngleRef = useRef<ViewAngle | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [modelState, setModelState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [autoDetect, setAutoDetect] = useState(true);
  const [manualRec, setManualRec] = useState(false);
  const [watch, setWatch] = useState("");
  const [liveAngle, setLiveAngle] = useState<ViewAngle | null>(null);
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
  // Pinch/slider zoom for the uploaded clip preview. `pan` is the crop top-left
  // (normalized); `uploadAspect` matches the container to the video so the
  // zoom transform and the analysis crop share the same coordinates.
  const [uZoom, setUZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [uploadAspect, setUploadAspect] = useState<string | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
      setErr(t("AI解析エンジンの読み込みに失敗しました。通信環境を確認して再試行してください。"));
      return null;
    }
  }

  function startLoop() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }

  // Auto-detect Front vs Down-the-Line from the live pose (shoulderW/torso),
  // smoothed so it doesn't flicker mid-swing.
  function detectLiveAngle(pose: Frame) {
    const ls = pose[LM.lShoulder];
    const rs = pose[LM.rShoulder];
    const lh = pose[LM.lHip];
    const rh = pose[LM.rHip];
    if (!ls || !rs || !lh || !rh) return;
    const shW = Math.abs(ls.x - rs.x);
    const torso = Math.abs((ls.y + rs.y) / 2 - (lh.y + rh.y) / 2) || 1e-3;
    const ratio = shW / torso;
    angleEmaRef.current = angleEmaRef.current ? angleEmaRef.current * 0.9 + ratio * 0.1 : ratio;
    const a: ViewAngle = angleEmaRef.current > 0.85 ? "front" : "dtl";
    if (a !== liveAngleRef.current) {
      liveAngleRef.current = a;
      setLiveAngle(a);
    }
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
            detectLiveAngle(pose);
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
  function runDetector(pose: Frame, now: number) {
    const prev = prevPoseRef.current;
    prevPoseRef.current = pose;
    if (!prev) return;
    const energy = motionEnergy(pose, prev);
    if (energy < E_QUIET) lastQuietRef.current = now;

    if (!swingActiveRef.current) {
      // Trigger only when a burst follows a recent quiet (address) period.
      const wasRecentlyQuiet = lastQuietRef.current > 0 && now - lastQuietRef.current < 1500;
      if (energy > E_BURST && wasRecentlyQuiet) {
        swingActiveRef.current = true;
        windowStartRef.current = lastQuietRef.current - 300; // include address
        peakTimeRef.current = now;
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
        peakTimeRef.current = now;
      }
      const settled = energy < E_SETTLE && now - peakTimeRef.current > 300;
      const tooLong = now - windowStartRef.current > 3500;
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
      return t("カメラの使用が許可されませんでした。ブラウザのアドレスバーからカメラを「許可」に変更してください。");
    if (name === "NotFoundError" || name === "OverconstrainedError")
      return t("利用できるカメラが見つかりませんでした。動画アップロードをご利用ください。");
    if (name === "NotReadableError")
      return t("カメラが他のアプリで使用中の可能性があります。他のアプリを閉じて再試行してください。");
    return t("カメラを起動できませんでした。権限を確認するか、動画アップロードをお試しください。");
  }

  async function startCamera(opts?: { facing?: "environment" | "user"; deviceId?: string }) {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr(t("このブラウザ/接続ではカメラを利用できません（HTTPS環境が必要です）。動画アップロードをご利用ください。"));
      return;
    }
    const want = opts?.facing ?? facing;
    // Stop any existing stream first (needed when switching cameras / lenses).
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Leaving upload mode → drop the clip's zoom/aspect so the live view is normal.
    setUploadAspect(null);
    setUZoom(1);
    setPan({ x: 0, y: 0 });
    setStage("loading");
    // 1080p + 60fps when the device can: sharper landmarks for the pose model
    // and twice the temporal resolution through impact. `ideal` never rejects —
    // unsupported devices just deliver their best mode.
    const quality: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    };
    const videoConstraint: MediaTrackConstraints = opts?.deviceId
      ? { deviceId: { exact: opts.deviceId }, ...quality }
      : { facingMode: { ideal: want }, ...quality };
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
      setUploadAspect(video.videoWidth && video.videoHeight ? `${video.videoWidth}/${video.videoHeight}` : "3/4");
      setUZoom(1);
      setPan({ x: 0, y: 0 });
      try {
        video.pause();
      } catch {
        /* ignore */
      }
      setStage("trim");
      // Show the first frame (paused). A tiny non-zero seek forces the frame to
      // be presented so it actually renders on mobile.
      setTimeout(() => seekPreview(0.03), 60);
    } catch (e) {
      setErr(t("動画を読み込めませんでした。別の動画ファイルでお試しください。"));
      setStage("idle");
      console.error(e);
    }
  }

  // --- Upload preview zoom / pan -------------------------------------------
  const isUpload = uploadAspect !== null;
  function clampPan(p: { x: number; y: number }, z: number) {
    const m = Math.max(0, 1 - 1 / z);
    return { x: Math.min(Math.max(p.x, 0), m), y: Math.min(Math.max(p.y, 0), m) };
  }
  function applyUZoom(z: number, focus?: { x: number; y: number }) {
    const nz = Math.min(5, Math.max(1, z));
    setUZoom(nz);
    // Keep the current view centre (or `focus`) under the same screen point.
    setPan((p) => {
      const f = focus ?? { x: p.x + 1 / uZoom / 2, y: p.y + 1 / uZoom / 2 };
      return clampPan({ x: f.x - 1 / nz / 2, y: f.y - 1 / nz / 2 }, nz);
    });
  }
  function resetZoom() {
    setUZoom(1);
    setPan({ x: 0, y: 0 });
  }
  function onPreviewTouchStart(e: React.TouchEvent) {
    if (!isUpload) return;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy) || 1, zoom: uZoom };
      dragRef.current = null;
    } else if (e.touches.length === 1 && uZoom > 1) {
      dragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, px: pan.x, py: pan.y };
    }
  }
  function onPreviewTouchMove(e: React.TouchEvent) {
    if (!isUpload) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy) || 1;
      applyUZoom(pinchRef.current.zoom * (d / pinchRef.current.dist));
    } else if (e.touches.length === 1 && dragRef.current) {
      const ddx = (e.touches[0].clientX - dragRef.current.x) / rect.width;
      const ddy = (e.touches[0].clientY - dragRef.current.y) / rect.height;
      setPan(clampPan({ x: dragRef.current.px - ddx / uZoom, y: dragRef.current.py - ddy / uZoom }, uZoom));
    }
  }
  function onPreviewTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 0) {
      pinchRef.current = null;
      dragRef.current = null;
    }
  }
  // CSS transform that crops the preview to the current zoom/pan (origin centre).
  const cropCx = pan.x + 1 / uZoom / 2;
  const cropCy = pan.y + 1 / uZoom / 2;
  const zoomTransform = `scale(${uZoom}) translate(${(0.5 - cropCx) * 100}%, ${(0.5 - cropCy) * 100}%)`;

  // Draw the video's current frame onto the overlay canvas. Seeking a *paused*
  // video does not reliably repaint the <video> element on iOS/Safari, so we
  // render the frame ourselves; the canvas shares the video's transform, so the
  // zoom/pan still applies and it stays pixel-aligned with the (hidden) video.
  function renderPreviewFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }

  // Seek the upload preview to a time and render that exact frame. The frame is
  // drawn once it is actually presented (requestVideoFrameCallback — which fires
  // after a seek even while paused), with 'seeked' + a timeout as fallbacks.
  function seekPreview(t: number) {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.min(Math.max(0, t), uploadDur || t);
    type RVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const v = video as RVFC;
    if (typeof v.requestVideoFrameCallback === "function") {
      v.requestVideoFrameCallback(() => renderPreviewFrame());
    }
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      renderPreviewFrame();
    };
    video.addEventListener("seeked", onSeeked);
    setTimeout(renderPreviewFrame, 160); // safety net (e.g. time unchanged)
    try {
      video.currentTime = clamped;
    } catch {
      /* ignore */
    }
  }

  // Deterministically step through the selected range frame-by-frame (via
  // seeking) so the impact frame is never missed, regardless of device speed.
  // Analyze the chosen trim range by PLAYING it (slowed) and grabbing every
  // presented frame via requestVideoFrameCallback. Unlike seeking a paused
  // video — which on iOS/Safari yields undecoded/blank frames and detects no
  // pose — playback guarantees decoded frames, and rVFC never misses a frame
  // (so the impact frame is always captured). Falls back to rAF when needed.
  async function scanRange() {
    const video = videoRef.current;
    const model = landmarkerRef.current ?? (await ensureModel());
    if (!video || !model) return;
    // Stop the live camera rAF loop so it can't call detectForVideo on the same
    // model concurrently (which would corrupt the monotonic timestamp sequence).
    cancelAnimationFrame(rafRef.current);
    const start = trimStart;
    const end = Math.max(trimStart + 0.2, trimEnd);
    const range = end - start;
    analyzingRef.current = true;
    stageRef.current = "analyzing";
    setStage("analyzing");
    setNotice("");
    setScanPct(0);

    // Detection input is ALWAYS rendered to a small, capped-resolution offscreen
    // canvas (long side ≤ TARGET). This keeps memory/CPU bounded on phones with
    // high-res (1080p/4K) clips — feeding full-res frames every tick can OOM and
    // crash the tab. When zoomed we crop first, which also enlarges a small/distant
    // subject within the detection canvas. Landmarks come back normalized, so the
    // canvas pixel size is irrelevant to coordinates.
    const z = uZoom;
    const px = pan.x;
    const py = pan.y;
    const TARGET = 540;
    const detectSource = (): HTMLCanvasElement => {
      let cc = cropCanvasRef.current;
      if (!cc) {
        cc = document.createElement("canvas");
        cropCanvasRef.current = cc;
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sw = z > 1 ? vw / z : vw;
      const sh = z > 1 ? vh / z : vh;
      const sx = z > 1 ? px * vw : 0;
      const sy = z > 1 ? py * vh : 0;
      const scale = TARGET / Math.max(sw, sh);
      const dw = Math.max(1, Math.round(sw * scale));
      const dh = Math.max(1, Math.round(sh * scale));
      if (cc.width !== dw || cc.height !== dh) {
        cc.width = dw;
        cc.height = dh;
      }
      const cx = cc.getContext("2d");
      if (cx) cx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
      return cc;
    };
    const mapPose = (pose: Frame): Frame =>
      z <= 1
        ? pose
        : pose.map((p) => ({ ...p, x: px + p.x / z, y: py + p.y / z }));

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    const draw = (pose: Frame) => {
      if (!ctx || !canvas) return;
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawSkeleton(ctx, pose, canvas.width, canvas.height);
    };

    // Seek to the start (resolve even if no 'seeked' event fires).
    await new Promise<void>((resolve) => {
      if (Math.abs(video.currentTime - start) < 0.05) return resolve();
      const onSeek = () => {
        video.removeEventListener("seeked", onSeek);
        resolve();
      };
      video.addEventListener("seeked", onSeek);
      const guard = setTimeout(() => {
        video.removeEventListener("seeked", onSeek);
        resolve();
      }, 800);
      try {
        video.currentTime = start;
      } catch {
        clearTimeout(guard);
        resolve();
      }
    });

    const frames: Frame[] = [];
    const MAX_FRAMES = 140; // hard cap on detections (bounds work on long clips)
    const MIN_DT = 0.028; // process at most ~35 fps of media time
    let lastProc = -1;
    video.muted = true;
    video.playbackRate = 0.6; // slow → more samples per frame of swing
    await video.play().catch(() => {});

    type RVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const hasRVFC = typeof (video as RVFC).requestVideoFrameCallback === "function";

    await new Promise<void>((resolve) => {
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        resolve();
      };
      const schedule = () => {
        if (stopped) return;
        if (hasRVFC) (video as RVFC).requestVideoFrameCallback!(grab);
        else rafRef.current = requestAnimationFrame(grab);
      };
      const grab = () => {
        if (stopped) return;
        const t = video.currentTime;
        if (video.ended || video.paused || t >= end || frames.length >= MAX_FRAMES) return stop();
        // Throttle by media time so frame rate / device speed don't change the load.
        if (t >= start - 0.06 && t - lastProc >= MIN_DT && video.readyState >= 2 && video.videoWidth) {
          lastProc = t;
          try {
            const ts = Math.max(performance.now(), lastTsRef.current + 1);
            lastTsRef.current = ts;
            const res = model.detectForVideo(detectSource(), ts);
            const raw = res.landmarks?.[0] as Frame | undefined;
            if (raw) {
              const pose = mapPose(raw);
              frames.push(pose);
              draw(pose);
            }
          } catch {
            /* skip bad frame */
          }
          setScanPct(Math.min(99, Math.round(((t - start) / range) * 100)));
        }
        schedule();
      };
      schedule();
      // Hard safety stop in case playback stalls.
      setTimeout(stop, (range / 0.6) * 1000 + 3000);
    });

    video.pause();
    video.playbackRate = 1;
    setScanPct(100);

    const fps = range > 0 ? frames.length / range : 30;
    if (frames.length < 6) {
      setErr(t("選択範囲で骨格を検出できませんでした。被写体（全身）がもう少し大きく映る動画か、明るい場所で撮影した動画でお試しください。"));
      analyzingRef.current = false;
      stageRef.current = "trim";
      setStage("trim");
      return;
    }
    setNotice(t("選択範囲 {start}〜{end}秒（{frames}コマ）を解析", { start: start.toFixed(1), end: end.toFixed(1), frames: frames.length }));
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
            ? t("骨格を検出できませんでした。全身（頭から足まで）がフレームに入るようカメラから2〜3m離れ、明るい場所で再撮影してください。")
            : t("スイングをうまく解析できませんでした。全身が映る位置で、もう一度ゆっくりスイングしてみてください。"),
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
      setErr(t("解析中に問題が発生しました。もう一度お試しください。"));
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
      <PageHeader title={t("スイングAI解析")} subtitle={t("骨格をリアルタイム計測・プロと比較")} back />

      <div className="px-4 space-y-4">
        {!profile?.height_cm && (
          <Link href="/profile" className="card p-3 text-sm block">
            ⚠️ {t("先に")}<span style={{ color: "var(--green)" }}>{t("体型プロフィール")}</span>{t("を登録すると、あなたに最適なプロと比較できます（未登録時は標準体型で比較）。")}
          </Link>
        )}

        {showCamera && (
          <div className="flex items-center gap-2">
            <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>{t("使用クラブ")}</span>
            <select value={club} onChange={(e) => setClub(e.target.value)} className="flex-1 px-2 py-2 text-sm">
              {CLUBS.map((c) => (
                <option key={c.id} value={c.id}>{t(c.label)}</option>
              ))}
            </select>
          </div>
        )}

        {/* Camera / video stage */}
        <div className={showCamera ? "block" : "hidden"}>
          <Card className="p-0 overflow-hidden">
            <div
              className={`relative bg-black overflow-hidden ${isUpload && uploadAspect ? "" : "aspect-[3/4]"}`}
              style={isUpload && uploadAspect ? { aspectRatio: uploadAspect, touchAction: "none" } : undefined}
              onTouchStart={onPreviewTouchStart}
              onTouchMove={onPreviewTouchMove}
              onTouchEnd={onPreviewTouchEnd}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-contain"
                style={{ transform: isUpload ? zoomTransform : cameraTransform }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                style={{ transform: isUpload ? zoomTransform : cameraTransform }}
              />
              {stage === "ready" && (
                <button
                  onClick={switchCamera}
                  className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5"
                >
                  🔄 {t("前後切替")}
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
                  {t(watch)}
                </div>
              )}
              {stage === "ready" && !isUpload && liveAngle && (
                <div
                  className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[11px] font-bold"
                  style={{ background: "rgba(0,0,0,0.6)", color: "#7dd3fc" }}
                >
                  📐 {t(ANGLE_LABEL[liveAngle])}{t("（自動）")}
                </div>
              )}
              {stage === "idle" && (
                <div className="absolute inset-0 grid place-items-center text-center px-6">
                  <div>
                    <div className="text-4xl mb-2">🏌️</div>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {t("全身が映るようにスマホを縦に置き、")}<br />{t("正面または後方から撮影します")}
                    </p>
                  </div>
                </div>
              )}
              {stage === "loading" && (
                <div className="absolute inset-0 grid place-items-center">
                  <Spinner label={t("カメラを起動中…")} />
                </div>
              )}
              {modelState === "loading" && stage !== "loading" && stage !== "idle" && (
                <div
                  className="absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[11px] flex items-center gap-1.5"
                  style={{ background: "rgba(0,0,0,0.65)", color: "#fff" }}
                >
                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t("AI解析エンジン準備中…")}
                </div>
              )}
              {stage === "analyzing" && (
                <div className="absolute inset-0 grid place-items-center bg-black/40">
                  <div className="text-center">
                    <Spinner label={scanPct > 0 ? t("スキャン中… {scanPct}%", { scanPct }) : t("スイングを解析中…")} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Video trim: choose exactly the swing portion */}
          {stage === "trim" && (
            <div className="mt-3 space-y-3">
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {t("拡大・縮小（ピンチ操作も可）— 被写体が小さいときに寄せると精度が上がります")}
                  </div>
                  <button onClick={resetZoom} className="text-[11px] underline" style={{ color: "var(--green)" }}>
                    {t("リセット")}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => applyUZoom(uZoom - 0.5)}
                    className="btn btn-ghost w-9 h-9 grid place-items-center text-lg leading-none"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={0.1}
                    value={uZoom}
                    onChange={(e) => applyUZoom(Number(e.target.value))}
                    className="flex-1"
                  />
                  <button
                    onClick={() => applyUZoom(uZoom + 0.5)}
                    className="btn btn-ghost w-9 h-9 grid place-items-center text-lg leading-none"
                  >
                    ＋
                  </button>
                  <span className="text-[11px] w-10 text-right tabular-nums" style={{ color: "var(--muted)" }}>
                    {uZoom.toFixed(1)}×
                  </span>
                </div>
                {uZoom > 1 && (
                  <div className="text-[11px] mt-1.5" style={{ color: "var(--muted)" }}>
                    {t("1本指ドラッグで表示位置を移動できます。この拡大範囲がそのまま解析されます。")}
                  </div>
                )}
              </Card>
              <Card>
                <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                  {t("解析するスイングの範囲を指定（不要な素振り・歩行を除外すると精度が上がります）")}
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[11px] mb-1" style={{ color: "var(--muted)" }}>
                      <span>{t("開始: {sec}秒", { sec: trimStart.toFixed(1) })}</span>
                      <button onClick={() => seekPreview(trimStart)} className="underline" style={{ color: "var(--green)" }}>
                        {t("この位置を表示")}
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
                      <span>{t("終了: {sec}秒", { sec: trimEnd.toFixed(1) })}</span>
                      <button onClick={() => seekPreview(trimEnd)} className="underline" style={{ color: "var(--green)" }}>
                        {t("この位置を表示")}
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
                    {t("選択範囲 {sec}秒（アドレス〜フィニッシュが収まる長さが目安）", { sec: (trimEnd - trimStart).toFixed(1) })}
                  </div>
                </div>
              </Card>
              <div className="grid grid-cols-2 gap-2">
                <label className="btn btn-ghost py-3 text-center cursor-pointer">
                  {t("別の動画")}
                  <input type="file" accept="video/*" className="hidden" onChange={onFile} />
                </label>
                <button onClick={scanRange} className="btn btn-primary py-3">
                  ✂ {t("この範囲を解析")}
                </button>
              </div>
            </div>
          )}

          {/* Lens + zoom controls (live camera only) */}
          {stage === "ready" && (
            <div className="mt-3 space-y-2">
              {devices.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>{t("レンズ")}</span>
                  <select
                    value={deviceId}
                    onChange={(e) => startCamera({ deviceId: e.target.value })}
                    className="flex-1 px-2 py-2 text-sm"
                  >
                    {backLenses.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || t("カメラ {n}", { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {zoomCaps && (
                <div className="flex items-center gap-2">
                  <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>
                    {zoomCaps.min < 1 ? t("広角") : t("ズーム")}
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
                📷 {t("カメラで撮影")}
              </button>
              <label className="btn btn-ghost py-3 text-center cursor-pointer">
                🎞 {t("動画を選択")}
                <input type="file" accept="video/*" className="hidden" onChange={onFile} />
              </label>
            </div>
          ) : stage === "ready" ? (
            <div className="mt-3 space-y-2">
              {modelState === "error" ? (
                <button onClick={() => ensureModel()} className="btn btn-primary py-3 w-full">
                  ↻ {t("AIエンジンを再読み込み")}
                </button>
              ) : modelState !== "ready" ? (
                <div className="text-center text-sm py-3" style={{ color: "var(--muted)" }}>
                  {t("AI解析エンジンを準備中…")}
                </div>
              ) : (
                <>
                  <div className="card px-3 py-2.5 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{t("自動スイング検出")}</div>
                      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
                        {t("時間制限なし。構えてからゆっくり打ってOK")}
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
                        ■ {t("終了して解析")}
                      </button>
                    ) : (
                      <button onClick={startManual} className="btn btn-primary py-3.5 w-full">
                        ● {t("検知開始（手動）")}
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
  const t = useT();
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
          {pro ? t("{name} とのシンクロ率", { name: pro.name }) : t("スイング完成度")}
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
          {t("3Dワイヤーフレーム（4ポジション）")}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {phases.map(([key, label]) => (
            <PhaseFigure key={key} frame={phaseFrames[key] ?? null} label={t(label)} size={72} />
          ))}
        </div>
      </Card>

      {/* Plane compare */}
      {pro && (
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            {t("スイングプレーン比較")}
          </div>
          <PlaneCompare user={result.swingPlane} proDeg={pro.swing_plane_deg} accent={pro.accent} />
          <div className="grid grid-cols-2 gap-2 mt-3 text-center">
            <Metric label={t("あなた")} value={`${result.swingPlane}°`} color="var(--cyan)" />
            <Metric label={pro.name} value={`${pro.swing_plane_deg}°`} color={pro.accent} />
          </div>
        </Card>
      )}

      {/* Virtual head speed / efficiency */}
      {result.headSpeed > 0 && (
        <Card>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
            {t("バーチャル・ヘッドスピード（骨格＋映像から推定）")}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>{t("推定ヘッドスピード")}</div>
              <div className="font-bold text-xl" style={{ color: "var(--cyan)" }}>
                {result.headSpeed}<span className="text-xs">m/s</span>
              </div>
            </div>
            <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>{t("手元スピード")}</div>
              <div className="font-bold text-xl">
                {result.handSpeed}<span className="text-xs">m/s</span>
              </div>
            </div>
            <div className="rounded-xl py-2" style={{ background: "var(--bg-soft)" }}>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>{t("効率（タメ）")}</div>
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
              ? t("タメが解けて効率よく加速できています（手元の減速→ヘッドが走る）。")
              : t("手元が走り続け＝手打ち傾向。下半身リードでタメを保ちましょう。")}
            {" "}{t("※ クラブ非検出のため映像と骨格からの推定値です。")}
          </p>
        </Card>
      )}

      {/* Metrics grid */}
      <Card>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <KV k={t("肩の回転 (トップ)")} v={`${result.shoulderTurn}°`} ref_={pro?.shoulder_turn_deg} unit="°" />
          <KV k={t("腰の回転 (トップ)")} v={`${result.hipTurn}°`} ref_={pro?.hip_turn_deg} unit="°" />
          <KV k={t("前傾(背骨)角")} v={`${result.spineTilt}°`} ref_={pro?.spine_tilt_deg} unit="°" />
          <KV k={t("テンポ比")} v={`${result.tempoRatio}`} ref_={pro?.tempo_ratio} unit="" />
          <KV k={t("軸の横ブレ")} v={`${result.swayCm}cm`} />
          <KV k={t("リード腕(インパクト)")} v={`${result.leadArmImpact}°`} />
        </div>
      </Card>

      {/* Faults */}
      <Card>
        <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
          {t("一言原因究明（{n}件）", { n: faults.length })}
        </div>
        {faults.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--green)" }}>
            ✓ {t("大きな悪癖は検出されませんでした。ナイススイング！")}
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
            🔎 {t("リバース・エンジニアリング診断（根本原因の巻き戻し）")}
          </div>
          <p className="text-[11px] mb-3" style={{ color: "var(--muted)" }}>
            {t("結果から時間を遡り、悪癖の引き金になった最初の動きを特定します。")}
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
                    {s.tMs !== 0 && t("（インパクト{tMs}ms）", { tMs: s.tMs })}
                    {i === result.rootCause.length - 1 && t(" ← 根本原因")}
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
          {t("もう一度")}
        </button>
        <button onClick={onSave} className="btn btn-primary py-3">
          {saved ? t("保存しました ✓") : t("記録を保存")}
        </button>
      </div>
      {faults.length > 0 && (
        <Link href="/coach" className="btn btn-ghost py-3 block text-center">
          🧠 {t("この診断から練習メニューを作る")}
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
  const t = useT();
  return (
    <div>
      <div className="text-[11px]" style={{ color: "var(--muted)" }}>
        {k}
      </div>
      <div className="font-semibold">
        {v}
        {ref_ != null && (
          <span className="text-[11px] ml-1" style={{ color: "var(--muted)" }}>
            / {t("理想")} {ref_}
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
