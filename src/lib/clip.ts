"use client";

import { detectEvents } from "./ghost-sync";
import { toFlat } from "./cross-angle";
import type { Frame } from "./pose";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";

// A processed swing clip: the source video URL plus the pose frames / impact
// anchor needed to drive the synced cross-angle player and analysis. Shared by
// the cross-angle analyzer (manual upload) and the live sync recorder.
export interface Clip {
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

// --- Audio impact detection ------------------------------------------------
// The loud, sharp transient of the impact (打音 / 打球音) is the most reliable
// shared event across two phones. We find the window with the largest onset
// (sudden rise in energy) weighted by loudness. Returns media seconds, or null
// if the clip has no usable audio.
export async function findImpactAudio(blob: Blob): Promise<number | null> {
  try {
    const ab = await blob.arrayBuffer();
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

export function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
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

// Extract pose frames (+ media timestamps) from a clip blob, and pick the impact
// anchor. Audio impact is preferred; pose-based (fastest-hand frame) is the
// fallback when the clip has no audio. The returned Clip owns a freshly created
// object URL — the caller is responsible for revoking it.
export async function extractClip(
  blob: Blob,
  model: PoseLandmarker,
  leftHanded: boolean,
  onPct: (p: number) => void,
): Promise<Clip> {
  const url = URL.createObjectURL(blob);
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

  const audioImpact = await findImpactAudio(blob);
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
