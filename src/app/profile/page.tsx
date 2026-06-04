"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { fetchPros, getProfile, upsertProfile } from "@/lib/db";
import { matchPro } from "@/lib/swing";
import { getPoseLandmarker, drawSkeleton, LM, type Frame } from "@/lib/pose";
import type { Pro, Profile } from "@/lib/types";

export default function ProfilePage() {
  const [pros, setPros] = useState<Pro[]>([]);
  const [form, setForm] = useState({
    nickname: "",
    height_cm: "" as string,
    arm_length_cm: "" as string,
    shoulder_width_cm: "" as string,
    leg_length_cm: "" as string,
    dominant_hand: "right",
  });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  useEffect(() => {
    (async () => {
      const [pr, p] = await Promise.all([fetchPros(), getProfile()]);
      setPros(pr);
      if (p) {
        setForm({
          nickname: p.nickname ?? "",
          height_cm: p.height_cm?.toString() ?? "",
          arm_length_cm: p.arm_length_cm?.toString() ?? "",
          shoulder_width_cm: p.shoulder_width_cm?.toString() ?? "",
          leg_length_cm: p.leg_length_cm?.toString() ?? "",
          dominant_hand: p.dominant_hand ?? "right",
        });
      }
      setLoading(false);
    })();
  }, []);

  const num = (s: string) => (s === "" ? null : Number(s));
  const body = {
    height_cm: num(form.height_cm),
    arm_length_cm: num(form.arm_length_cm),
    shoulder_width_cm: num(form.shoulder_width_cm),
    leg_length_cm: num(form.leg_length_cm),
  };
  const match = form.height_cm ? matchPro(pros, body) : null;

  async function save() {
    const profile: Partial<Profile> = {
      nickname: form.nickname || null,
      ...body,
      dominant_hand: form.dominant_hand,
      matched_pro_id: match?.pro.id ?? null,
    };
    await upsertProfile(profile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const field = (
    key: keyof typeof form,
    label: string,
    placeholder: string,
    hint?: string,
  ) => (
    <label className="block">
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full px-3 py-2.5 mt-1"
      />
      {hint && (
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          {hint}
        </span>
      )}
    </label>
  );

  return (
    <main>
      <PageHeader title="体型・骨格プロフィール" subtitle="あなたに近いプロを自動選定" back />
      <div className="px-4 space-y-4">
        <Card className="space-y-3">
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              ニックネーム
            </span>
            <input
              value={form.nickname}
              placeholder="ゴルファー名"
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              className="w-full px-3 py-2.5 mt-1"
            />
          </label>
          {field("height_cm", "身長 (cm)", "172")}

          <div>
            <button
              onClick={() => setScanning(true)}
              disabled={!form.height_cm}
              className="btn btn-ghost w-full py-2.5 text-sm disabled:opacity-50"
              style={{ border: "1px solid var(--green)", color: "var(--green)" }}
            >
              📷 カメラで体型を自動計測
            </button>
            <span className="text-[10px] block mt-1" style={{ color: "var(--muted)" }}>
              {form.height_cm
                ? "全身が映るようスマホを立て、2〜3m離れて正面に立つと、腕・脚・肩幅・胴体の比率を自動計測します。"
                : "先に身長を入力してください（計測の基準になります）。"}
            </span>
            {scanMsg && (
              <span className="text-[11px] block mt-1" style={{ color: "var(--cyan)" }}>{scanMsg}</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {field("arm_length_cm", "腕の長さ (cm)", "76", "肩〜手首")}
            {field("shoulder_width_cm", "肩幅 (cm)", "45")}
          </div>
          {field("leg_length_cm", "脚の長さ (cm)", "90", "股下")}
          <label className="block">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              利き手
            </span>
            <select
              value={form.dominant_hand}
              onChange={(e) => setForm({ ...form, dominant_hand: e.target.value })}
              className="w-full px-3 py-2.5 mt-1"
            >
              <option value="right">右打ち</option>
              <option value="left">左打ち</option>
            </select>
          </label>
        </Card>

        {match && (
          <Card>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              骨格シンクロ・ランキング
            </div>
            <div className="mt-2 space-y-2">
              {match.ranking.slice(0, 4).map((r, i) => (
                <div key={r.pro.id} className="flex items-center gap-3">
                  <div
                    className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold shrink-0"
                    style={{ background: r.pro.accent + "33", color: r.pro.accent }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{r.pro.name}</div>
                    <div className="h-1.5 rounded-full mt-1" style={{ background: "var(--line)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${r.sync}%`, background: r.pro.accent }}
                      />
                    </div>
                  </div>
                  <div className="text-sm font-bold" style={{ color: r.pro.accent }}>
                    {r.sync}%
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <button
          onClick={save}
          disabled={loading || !form.height_cm}
          className="btn btn-primary w-full py-3.5 disabled:opacity-50"
        >
          {saved ? "保存しました ✓" : "保存して理想のプロを確定"}
        </button>
      </div>

      {scanning && (
        <BodyScan
          heightCm={Number(form.height_cm) || 172}
          onClose={() => setScanning(false)}
          onMeasured={(m) => {
            setForm((f) => ({
              ...f,
              arm_length_cm: String(m.arm),
              shoulder_width_cm: String(m.shoulder),
              leg_length_cm: String(m.leg),
            }));
            setScanMsg(`計測完了：腕 ${m.arm} / 肩幅 ${m.shoulder} / 脚 ${m.leg} cm（下のランキングに反映）`);
            setScanning(false);
          }}
        />
      )}
    </main>
  );
}

interface Measured {
  arm: number;
  shoulder: number;
  leg: number;
}

// Camera body-profiling: measure limb/shoulder/leg lengths in pixels from the
// pose skeleton, take ratios to full stature, then convert to cm via the user's
// known height. Ratios (not absolute px) keep it camera-distance independent.
function BodyScan({
  heightCm,
  onClose,
  onMeasured,
}: {
  heightCm: number;
  onClose: () => void;
  onMeasured: (m: Measured) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<Awaited<ReturnType<typeof getPoseLandmarker>> | null>(null);
  const rafRef = useRef(0);
  const tsRef = useRef(0);
  const collectingRef = useRef(false);
  const collectCountRef = useRef(0);
  const samplesRef = useRef<{ arm: number; sh: number; leg: number }[]>([]);
  const poseOkRef = useRef(false);
  const lastVisRef = useRef(false);
  const finishRef = useRef<() => void>(() => {});
  const COLLECT_FRAMES = 72; // ~2.5s at ~30fps

  const [ready, setReady] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;
    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const model = modelRef.current;
      if (video && canvas && model && video.readyState >= 2 && video.videoWidth) {
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          try {
            tsRef.current = Math.max(performance.now(), tsRef.current + 1);
            const res = model.detectForVideo(video, tsRef.current);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const pose = res.landmarks?.[0] as Frame | undefined;
            const m = pose ? measure(pose, video.videoWidth, video.videoHeight) : null;
            poseOkRef.current = !!m;
            if (pose) drawSkeleton(ctx, pose, canvas.width, canvas.height, m ? "#22c55e" : "#f59e0b");
            if (poseOkRef.current !== lastVisRef.current) {
              lastVisRef.current = poseOkRef.current;
              setBodyVisible(poseOkRef.current);
            }
            if (collectingRef.current) {
              if (m) samplesRef.current.push(m);
              collectCountRef.current += 1;
              setProgress(Math.min(100, Math.round((collectCountRef.current / COLLECT_FRAMES) * 100)));
              if (collectCountRef.current >= COLLECT_FRAMES) finishRef.current();
            }
          } catch {
            /* skip */
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stop) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.playsInline = true;
          await videoRef.current.play().catch(() => {});
        }
        modelRef.current = await getPoseLandmarker();
        setReady(true);
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        setErr("カメラまたは解析エンジンを起動できませんでした。");
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function startCollect() {
    samplesRef.current = [];
    collectCountRef.current = 0;
    collectingRef.current = true;
    setCollecting(true);
    setProgress(0);
    // Progress + completion are driven by the rAF detect loop (frame count).
  }

  function finish() {
    collectingRef.current = false;
    setCollecting(false);
    const s = samplesRef.current;
    if (s.length < 5) {
      setErr("全身がうまく映りませんでした。頭から足先まで入るよう離れて、もう一度お試しください。");
      return;
    }
    const med = (key: "arm" | "sh" | "leg") => {
      const arr = s.map((x) => x[key]).sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
    };
    // Medians are ratios to stature → convert to cm with the known height.
    const arm = Math.round(med("arm") * heightCm);
    const shoulder = Math.round(med("sh") * heightCm);
    const leg = Math.round(med("leg") * heightCm);
    onMeasured({ arm, shoulder, leg });
  }

  // Keep the loop's completion callback pointed at the latest closure.
  useEffect(() => {
    finishRef.current = finish;
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "rgba(0,0,0,0.92)" }}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-bold text-white">体型を自動計測</span>
        <button onClick={onClose} className="btn btn-ghost text-xs px-3 py-1.5 text-white">閉じる</button>
      </div>
      <div className="relative flex-1 mx-3 rounded-2xl overflow-hidden" style={{ background: "#000" }}>
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold"
          style={{ background: "rgba(0,0,0,0.6)", color: bodyVisible ? "#4ade80" : "#fff" }}
        >
          {!ready ? "起動中…" : bodyVisible ? "● 全身を検出 — 計測できます" : "○ 頭から足先まで映してください"}
        </div>
        {collecting && (
          <div className="absolute bottom-3 left-3 right-3">
            <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }}>
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#22c55e" }} />
            </div>
            <div className="text-center text-xs text-white mt-1">静止して計測中… {progress}%</div>
          </div>
        )}
      </div>
      <div className="p-4">
        {err ? (
          <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>{err}</p>
        ) : null}
        <button
          onClick={startCollect}
          disabled={!ready || !bodyVisible || collecting}
          className="btn btn-primary w-full py-3.5 disabled:opacity-40"
        >
          {collecting ? "計測中…" : "この姿勢で計測する（約3秒）"}
        </button>
      </div>
    </div>
  );
}

// One-frame measurement → ratios of (arm, shoulder, leg) to full stature, or
// null if the full body isn't reliably visible. Works in pixel space so x/y
// aspect doesn't distort the lengths.
function measure(p: Frame, vw: number, vh: number): { arm: number; sh: number; leg: number } | null {
  const idx = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
  for (const i of idx) {
    const lm = p[i];
    if (!lm || (lm.visibility ?? 1) < 0.3) return null;
  }
  const P = (i: number) => ({ x: p[i].x * vw, y: p[i].y * vh });
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  const nose = P(LM.nose);
  const ankleY = Math.max(P(LM.lAnkle).y, P(LM.rAnkle).y);
  const shoulderY = (P(LM.lShoulder).y + P(LM.rShoulder).y) / 2;
  const hipY = (P(LM.lHip).y + P(LM.rHip).y) / 2;
  // Must be upright & full height: shoulders above hips above ankles.
  if (!(shoulderY < hipY && hipY < ankleY)) return null;
  // Nose-to-ankle ≈ 0.83 of stature (nose ~0.90H, ankle ~0.07H).
  const stature = (ankleY - nose.y) / 0.83;
  if (stature < vh * 0.25) return null; // body too small / partial

  const arm =
    (d(P(LM.lShoulder), P(LM.lElbow)) + d(P(LM.lElbow), P(LM.lWrist)) +
      d(P(LM.rShoulder), P(LM.rElbow)) + d(P(LM.rElbow), P(LM.rWrist))) / 2;
  const sh = d(P(LM.lShoulder), P(LM.rShoulder));
  const leg =
    (d(P(LM.lHip), P(LM.lKnee)) + d(P(LM.lKnee), P(LM.lAnkle)) +
      d(P(LM.rHip), P(LM.rKnee)) + d(P(LM.rKnee), P(LM.rAnkle))) / 2;

  return { arm: arm / stature, sh: sh / stature, leg: leg / stature };
}
