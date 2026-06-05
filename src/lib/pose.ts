"use client";

import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type Landmark = NormalizedLandmark;
export type Frame = Landmark[];

// MediaPipe Pose landmark indices we use.
export const LM = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
} as const;

// Skeleton connections for the wireframe overlay.
export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [11, 12],
];

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        // Keep this version in sync with the installed @mediapipe/tasks-vision
        // in package.json — a JS/WASM version skew causes runtime failures.
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
      );
      const opts = (delegate: "GPU" | "CPU") => ({
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate,
        },
        runningMode: "VIDEO" as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        return await PoseLandmarker.createFromOptions(vision, opts("GPU"));
      } catch {
        // Some devices/browsers lack the WebGPU/WebGL delegate — fall back to CPU.
        return await PoseLandmarker.createFromOptions(vision, opts("CPU"));
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
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate,
        },
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

// Draw a 3D-looking wireframe of the skeleton onto a canvas.
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Frame,
  w: number,
  h: number,
  color = "#22d3ee",
) {
  ctx.lineWidth = Math.max(2, w / 220);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const [a, b] of POSE_CONNECTIONS) {
    const pa = lm[a];
    const pb = lm[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
    ctx.stroke();
  }
  for (const i of Object.values(LM)) {
    const p = lm[i];
    if (!p) continue;
    const r = Math.max(3, w / 130);
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
    // depth halo (fake-3D using z). Clamp the radius: arc() throws on a negative
    // radius, which happens whenever z is positive enough (e.g. on small canvases).
    const halo = Math.max(0, r + (p.z ?? 0) * -40);
    if (halo > 0) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, halo, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
