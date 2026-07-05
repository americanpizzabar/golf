"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type Landmark = NormalizedLandmark;
export type Frame = Landmark[];

// All 33 MediaPipe Pose landmark indices (face, hands and feet included so the
// skeleton is measured/drawn at full fidelity).
export const LM = {
  nose: 0,
  lEyeInner: 1,
  lEye: 2,
  lEyeOuter: 3,
  rEyeInner: 4,
  rEye: 5,
  rEyeOuter: 6,
  lEar: 7,
  rEar: 8,
  mouthL: 9,
  mouthR: 10,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lPinky: 17,
  rPinky: 18,
  lIndex: 19,
  rIndex: 20,
  lThumb: 21,
  rThumb: 22,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lFoot: 31,
  rFoot: 32,
} as const;

// Full MediaPipe pose connection set (face, arms, hands, torso, legs, feet).
export const POSE_CONNECTIONS: [number, number][] = [
  // face
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  // shoulders / torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // left arm + hand
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // right arm + hand
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // left leg + foot
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // right leg + foot
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

// Landmark groups for sizing nodes (face/hands drawn smaller than body joints).
const SMALL_NODES = new Set<number>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 19, 20, 21, 22, 29, 30, 31, 32]);

const MODEL_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker";
// "full" is markedly more precise on fast limbs (wrists mid-downswing) than
// "lite" at a still-realtime cost on phones; lite stays as the fallback for
// devices/networks where full can't load.
const MODEL_FULL = `${MODEL_BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`;
const MODEL_LITE = `${MODEL_BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        // Keep this version in sync with the installed @mediapipe/tasks-vision
        // in package.json — a JS/WASM version skew causes runtime failures.
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      const opts = (model: string, delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: "VIDEO" as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      // Preference order: full/GPU → full/CPU → lite/GPU → lite/CPU.
      try {
        return await PoseLandmarker.createFromOptions(vision, opts(MODEL_FULL, "GPU"));
      } catch { /* try next */ }
      try {
        return await PoseLandmarker.createFromOptions(vision, opts(MODEL_FULL, "CPU"));
      } catch { /* try next */ }
      try {
        return await PoseLandmarker.createFromOptions(vision, opts(MODEL_LITE, "GPU"));
      } catch {
        return await PoseLandmarker.createFromOptions(vision, opts(MODEL_LITE, "CPU"));
      }
    })();
    // Don't permanently cache a rejected init (e.g. transient network failure).
    landmarkerPromise.catch(() => {
      landmarkerPromise = null;
    });
  }
  return landmarkerPromise;
}

// Separate instance that also outputs a person segmentation mask (for the
// see-through silhouette). Kept separate so normal detection isn't slowed by the
// extra mask work.
let segPromise: Promise<PoseLandmarker> | null = null;
export async function getSegLandmarker(): Promise<PoseLandmarker> {
  if (!segPromise) {
    segPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      const opts = (delegate: "GPU" | "CPU") => ({
        // The silhouette overlay runs the mask every frame — lite keeps it
        // realtime; measurement accuracy comes from the main (full) landmarker.
        baseOptions: { modelAssetPath: MODEL_LITE, delegate },
        runningMode: "VIDEO" as const,
        numPoses: 1,
        outputSegmentationMasks: true,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        return await PoseLandmarker.createFromOptions(vision, opts("GPU"));
      } catch {
        return await PoseLandmarker.createFromOptions(vision, opts("CPU"));
      }
    })();
    segPromise.catch(() => {
      segPromise = null;
    });
  }
  return segPromise;
}

// Draw the full-fidelity skeleton (all valid of the 33 landmarks + connections).
// Landmarks that are unset (exactly 0,0 — e.g. the synthetic model's face/hands)
// or low-visibility are skipped so no stray points appear.
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Frame,
  w: number,
  h: number,
  color = "#22d3ee",
) {
  const valid = (p: Landmark | undefined): p is Landmark =>
    !!p && (p.visibility ?? 1) >= 0.2 && !(p.x === 0 && p.y === 0);
  ctx.lineWidth = Math.max(1.5, w / 260);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = lm[a];
    const pb = lm[b];
    if (!valid(pa) || !valid(pb)) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }
  for (let i = 0; i < lm.length && i < 33; i++) {
    const p = lm[i];
    if (!valid(p)) continue;
    const r = SMALL_NODES.has(i) ? Math.max(1.4, w / 360) : Math.max(2.6, w / 150);
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
