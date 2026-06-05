"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader, Card } from "@/components/ui";
import { getSegLandmarker, LM, type Frame } from "@/lib/pose";
import { generateModelSwing, generateModelSwingDTL } from "@/lib/model-swing";
import { interpFrame, ANGLE_LABEL, type ViewAngle } from "@/lib/ghost-sync";
import { matchPro } from "@/lib/swing";
import { fetchPros, getProfile } from "@/lib/db";
import type { MPMask } from "@mediapipe/tasks-vision";

type Pt = { x: number; y: number };

// Bones to "flesh" into a silhouette (filled thick capsules) + torso polygon.
const BONES: [number, number][] = [
  [LM.lShoulder, LM.lElbow], [LM.lElbow, LM.lWrist],
  [LM.rShoulder, LM.rElbow], [LM.rElbow, LM.rWrist],
  [LM.lShoulder, LM.lHip], [LM.rShoulder, LM.rHip], [LM.lShoulder, LM.rShoulder],
  [LM.lHip, LM.rHip], [LM.lHip, LM.lKnee], [LM.lKnee, LM.lAnkle],
  [LM.rHip, LM.rKnee], [LM.rKnee, LM.rAnkle],
];

export default function SilhouettePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const proRef = useRef<HTMLCanvasElement | null>(null); // offscreen pro mask
  const silRef = useRef<HTMLCanvasElement | null>(null); // offscreen composite
  const rafRef = useRef(0);
  const tsRef = useRef(0);
  const phaseRef = useRef(0);
  const modelRef = useRef<{ front: number[][]; dtl: number[][] } | null>(null);
  const angleEmaRef = useRef(0);
  const angleRef = useRef<ViewAngle>("front");
  const outRef = useRef<ImageData | null>(null);

  const [camOn, setCamOn] = useState(false);
  const [phase, setPhase] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [proName, setProName] = useState("");
  const [angle, setAngle] = useState<ViewAngle>("front");
  const [err, setErr] = useState("");
  const playingRef = useRef(false);

  useEffect(() => {
    (async () => {
      const [pros, p] = await Promise.all([fetchPros(), getProfile()]);
      const m = matchPro(pros, {
        height_cm: p?.height_cm,
        arm_length_cm: p?.arm_length_cm,
        shoulder_width_cm: p?.shoulder_width_cm,
        leg_length_cm: p?.leg_length_cm,
      });
      const pro = (p?.matched_pro_id ? pros.find((x) => x.id === p.matched_pro_id) : null) ?? m?.pro ?? pros[0];
      if (pro) {
        const lh = p?.dominant_hand === "left";
        const mir = (fr: number[][]) => (lh ? fr.map((f) => f.map((v, i) => (i % 2 === 0 ? 1 - v : v))) : fr);
        modelRef.current = { front: mir(generateModelSwing(pro, 45)), dtl: mir(generateModelSwingDTL(pro, 45)) };
        setProName(pro.name);
      }
    })();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("このブラウザ/接続ではカメラを利用できません（HTTPSが必要です）。");
      return;
    }
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch {
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        setErr("カメラを起動できませんでした。");
        return;
      }
    }
    streamRef.current = s;
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      videoRef.current.playsInline = true;
      await videoRef.current.play().catch(() => {});
    }
    let model;
    try {
      model = await getSegLandmarker();
    } catch {
      setErr("セグメンテーション・エンジンの読み込みに失敗しました。");
      return;
    }
    setCamOn(true);
    rafRef.current = requestAnimationFrame((now) => loop(now, model));
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setCamOn(false);
  }

  function loop(now: number, model: Awaited<ReturnType<typeof getSegLandmarker>>) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= 2 && video.videoWidth) {
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      try {
        tsRef.current += 33; // monotonic ms (this seg instance is exclusive to this page)
        const res = model.detectForVideo(video, tsRef.current);
        const user = res.landmarks?.[0] as Frame | undefined;
        const mask = res.segmentationMasks?.[0] as MPMask | undefined;
        if (user && mask) {
          if (playingRef.current) {
            phaseRef.current = (phaseRef.current + 0.006) % 1;
            setPhase(phaseRef.current);
          }
          updateAngle(user);
          render(canvas, user, mask);
        }
        res.segmentationMasks?.forEach((mm) => (mm as MPMask).close?.());
      } catch {
        /* skip frame */
      }
    }
    rafRef.current = requestAnimationFrame((n) => loop(n, model));
  }

  function updateAngle(user: Frame) {
    const ls = user[LM.lShoulder];
    const rs = user[LM.rShoulder];
    const lh = user[LM.lHip];
    const rh = user[LM.rHip];
    if (!ls || !rs || !lh || !rh) return;
    const shW = Math.abs(ls.x - rs.x);
    const torso = Math.abs((ls.y + rs.y) / 2 - (lh.y + rh.y) / 2) || 1e-3;
    angleEmaRef.current = angleEmaRef.current ? angleEmaRef.current * 0.9 + (shW / torso) * 0.1 : shW / torso;
    const a: ViewAngle = angleEmaRef.current > 0.85 ? "front" : "dtl";
    if (a !== angleRef.current) {
      angleRef.current = a;
      setAngle(a);
    }
  }

  // Align the pro model pose to the user's torso (similarity from hip→shoulder).
  function alignedPro(user: Frame): Pt[] | null {
    const models = modelRef.current;
    if (!models) return null;
    const frames = angleRef.current === "dtl" ? models.dtl : models.front;
    const flat = interpFrame(frames, phaseRef.current * (frames.length - 1));
    const mid = (ax: number, ay: number, bx: number, by: number) => ({ x: (ax + bx) / 2, y: (ay + by) / 2 });
    const mSh = mid(flat[LM.lShoulder * 2], flat[LM.lShoulder * 2 + 1], flat[LM.rShoulder * 2], flat[LM.rShoulder * 2 + 1]);
    const mHp = mid(flat[LM.lHip * 2], flat[LM.lHip * 2 + 1], flat[LM.rHip * 2], flat[LM.rHip * 2 + 1]);
    const uSh = mid(user[LM.lShoulder].x, user[LM.lShoulder].y, user[LM.rShoulder].x, user[LM.rShoulder].y);
    const uHp = mid(user[LM.lHip].x, user[LM.lHip].y, user[LM.rHip].x, user[LM.rHip].y);
    const mv = { x: mSh.x - mHp.x, y: mSh.y - mHp.y };
    const uv = { x: uSh.x - uHp.x, y: uSh.y - uHp.y };
    const ml = Math.hypot(mv.x, mv.y) || 1e-3;
    const scale = Math.hypot(uv.x, uv.y) / ml;
    const ang = Math.atan2(uv.y, uv.x) - Math.atan2(mv.y, mv.x);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const out: Pt[] = [];
    for (let i = 0; i < 33; i++) {
      const dx = (flat[i * 2] - mHp.x) * scale;
      const dy = (flat[i * 2 + 1] - mHp.y) * scale;
      out.push({ x: uHp.x + dx * cos - dy * sin, y: uHp.y + dx * sin + dy * cos });
    }
    return out;
  }

  function render(canvas: HTMLCanvasElement, user: Frame, mask: MPMask) {
    const mw = mask.width;
    const mh = mask.height;
    const arr = mask.getAsFloat32Array();
    // Offscreen pro mask
    if (!proRef.current) proRef.current = document.createElement("canvas");
    if (!silRef.current) silRef.current = document.createElement("canvas");
    const pro = proRef.current;
    const sil = silRef.current;
    if (pro.width !== mw) { pro.width = mw; pro.height = mh; sil.width = mw; sil.height = mh; }
    const pctx = pro.getContext("2d", { willReadFrequently: true })!;
    pctx.clearRect(0, 0, mw, mh);

    const pts = alignedPro(user);
    if (pts) {
      const torsoLen = Math.hypot(pts[LM.lShoulder].x - pts[LM.lHip].x, pts[LM.lShoulder].y - pts[LM.lHip].y);
      const lw = Math.max(3, torsoLen * mh * 0.34);
      pctx.fillStyle = "#fff";
      pctx.strokeStyle = "#fff";
      pctx.lineCap = "round";
      pctx.lineJoin = "round";
      pctx.lineWidth = lw;
      for (const [a, b] of BONES) {
        pctx.beginPath();
        pctx.moveTo(pts[a].x * mw, pts[a].y * mh);
        pctx.lineTo(pts[b].x * mw, pts[b].y * mh);
        pctx.stroke();
      }
      // torso fill
      pctx.beginPath();
      for (const i of [LM.lShoulder, LM.rShoulder, LM.rHip, LM.lHip]) pctx.lineTo(pts[i].x * mw, pts[i].y * mh);
      pctx.closePath();
      pctx.fill();
      // head
      pctx.beginPath();
      pctx.arc(pts[LM.nose].x * mw, pts[LM.nose].y * mh, lw * 0.9, 0, Math.PI * 2);
      pctx.fill();
    }
    const proAlpha = pctx.getImageData(0, 0, mw, mh).data;

    // Composite: cyan user, gold pro, red overflow (user outside pro).
    if (!outRef.current || outRef.current.width !== mw || outRef.current.height !== mh) {
      outRef.current = new ImageData(mw, mh);
    }
    const out = outRef.current.data;
    for (let i = 0; i < mw * mh; i++) {
      const u = arr[i] > 0.5;
      const p = proAlpha[i * 4 + 3] > 40;
      let r = 0, g = 0, b = 0, al = 0;
      if (u && !p) { r = 244; g = 63; b = 94; al = 165; } // overflow (hami-dashi)
      else if (u && p) { r = 34; g = 211; b = 238; al = 90; } // matched
      else if (!u && p) { r = 250; g = 204; b = 80; al = 80; } // pro reach you miss
      const o = i * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = al;
    }
    const sctx = sil.getContext("2d")!;
    sctx.putImageData(outRef.current, 0, 0);

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sil, 0, 0, canvas.width, canvas.height);
  }

  return (
    <main>
      <PageHeader title="シースルー・シルエット" subtitle="プロの輪郭と重ねてズレを可視化（β）" back />
      <div className="px-4 space-y-4">
        <Card className="p-0 overflow-hidden">
          <div className="relative bg-black aspect-[3/4]">
            <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-contain" />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
            {!camOn && (
              <div className="absolute inset-0 grid place-items-center text-center px-6">
                <div>
                  <div className="text-4xl mb-2">👤</div>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    全身が映るようスマホを立て、2〜3m離れて構えます。<br />
                    自分の輪郭にプロのシルエットを重ねて表示します。
                  </p>
                </div>
              </div>
            )}
            {camOn && (
              <div className="absolute top-2 left-2 px-3 py-1 rounded-full text-xs font-bold"
                style={{ background: "rgba(0,0,0,0.6)", color: "#7dd3fc" }}>
                📐 {ANGLE_LABEL[angle]}（自動）
              </div>
            )}
            {camOn && (
              <button onClick={stop} className="absolute top-2 right-2 btn btn-ghost text-xs px-3 py-1.5">停止</button>
            )}
          </div>
        </Card>

        {/* Legend */}
        <Card>
          <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
            <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: "#22d3ee" }} /> 一致</div>
            <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: "#f43f5e" }} /> ハミ出し</div>
            <div><span className="inline-block w-3 h-3 rounded-sm align-middle" style={{ background: "#facc50" }} /> プロの可動域</div>
          </div>
        </Card>

        {err && <Card className="text-sm" style={{ color: "#fca5a5" }}>{err}</Card>}

        {!camOn ? (
          <button onClick={start} className="btn btn-primary w-full py-3.5">📷 カメラを起動して重ね合わせ</button>
        ) : (
          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                お手本：<b style={{ color: "var(--fg)" }}>{proName || "—"}</b>（{ANGLE_LABEL[angle]}）
              </span>
              <button onClick={() => setPlaying((v) => !v)} className="btn btn-ghost text-xs px-3 py-1.5">
                {playing ? "⏸ 自動" : "▶ 自動再生"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] shrink-0" style={{ color: "var(--muted)" }}>局面</span>
              <input
                type="range" min={0} max={1} step={0.002} value={phase}
                onChange={(e) => { setPlaying(false); phaseRef.current = Number(e.target.value); setPhase(phaseRef.current); }}
                className="flex-1"
              />
            </div>
            <p className="text-[11px]" style={{ color: "var(--muted)" }}>
              スライダーでプロの局面（アドレス〜フィニッシュ）を動かし、同じ姿勢を取ってみてください。
              赤い部分はプロの輪郭から「ハミ出した」体の部分です。
            </p>
          </Card>
        )}

        <p className="text-[10px] leading-relaxed px-1" style={{ color: "var(--muted)" }}>
          ※ 自分の輪郭はカメラのAI人物セグメンテーションで抽出。プロのシルエットは、あなたと同じ体型のプロ
          （{proName || "自動選定"}）の骨格を肉付けし、あなたの胴体に合わせて重ねた近似モデルです（実スキャンではないためβ）。
        </p>
      </div>
    </main>
  );
}
