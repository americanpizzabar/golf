import type { Pro } from "./types";

// Procedurally generate an *idealized* reference swing as a compact landmark
// sequence (same [x0,y0,...] format as stored swings) so it can be overlaid as
// a "model" ghost. This is a kinematic model driven by a pro's target metrics,
// NOT a real motion capture — it visualises the ideal turn/arc/tempo so the user
// can mirror it. Right-handed reference (mirrored by the page for lefties).

const set = (f: number[], idx: number, x: number, y: number) => {
  f[idx * 2] = Math.round(x * 1000) / 1000;
  f[idx * 2 + 1] = Math.round(y * 1000) / 1000;
};

// Piecewise smoothstep interpolation across [t,value] keyframes.
function interp(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      const u = (t - t0) / (t1 - t0 || 1);
      const s = u * u * (3 - 2 * u); // smoothstep
      return v0 + (v1 - v0) * s;
    }
  }
  return keys[keys.length - 1][1];
}

const rad = (d: number) => (d * Math.PI) / 180;

export function generateModelSwing(pro: Pro, n = 30): number[][] {
  const STr = rad(pro.shoulder_turn_deg || 92);
  const HTr = rad(pro.hip_turn_deg || 48);

  // Anatomy (normalised). Address posture with spine tilt baked in.
  const cx = 0.5;
  const shoulderY = 0.42;
  const hipY = 0.62;
  const kneeY = 0.78;
  const ankleY = 0.93;
  const noseY = 0.31;
  const shoulderHalf = 0.1;
  const hipHalf = 0.075;
  const kneeHalf = 0.07;
  const footHalf = 0.085;
  const Rh = 0.18; // hand radius from shoulder centre

  // Rotation profiles over normalised swing time (1 = full backswing turn).
  const shoulderU: [number, number][] = [[0, 0], [0.4, 1], [0.66, -0.06], [1, -1.15]];
  const hipU: [number, number][] = [[0, 0], [0.33, 0.7], [0.55, -0.2], [1, -1.0]];
  // Club/hand angle (deg): address→top→impact→follow. The dense change into
  // impact yields a hand-speed peak just before impact, then deceleration.
  const handPsi: [number, number][] = [
    [0, 15], [0.18, 70], [0.4, 160], [0.55, 120], [0.66, 8], [0.8, -90], [1, -150],
  ];

  const frames: number[][] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const us = interp(shoulderU, t);
    const uh = interp(hipU, t);
    const psi = rad(interp(handPsi, t));

    const sWidth = shoulderHalf * Math.cos(us * STr);
    const hWidth = hipHalf * Math.cos(uh * HTr);
    const kWidth = kneeHalf * Math.cos(uh * HTr * 0.6);
    const scx = cx + 0.045 * Math.sin(us * STr); // upper-body shift (turn + weight)
    const hcx = cx + 0.03 * Math.sin(uh * HTr);

    // Secondary axis tilt: head stays behind the ball through impact.
    const impactProx = Math.max(0, 1 - Math.abs(t - 0.66) / 0.34);
    const headLean = 0.025 * impactProx;

    const f: number[] = new Array(66).fill(0);

    // Shoulders / hips / knees / ankles
    set(f, 11, scx - sWidth, shoulderY); // lShoulder
    set(f, 12, scx + sWidth, shoulderY); // rShoulder
    set(f, 23, hcx - hWidth, hipY);
    set(f, 24, hcx + hWidth, hipY);
    set(f, 25, hcx - kWidth, kneeY);
    set(f, 26, hcx + kWidth, kneeY);
    set(f, 27, cx - footHalf, ankleY);
    set(f, 28, cx + footHalf, ankleY);

    // Head
    set(f, 0, scx + headLean, noseY);

    // Hands (both wrists ~ together on the club)
    const hx = scx + Rh * 0.92 * Math.sin(psi);
    const hy = shoulderY + Rh * Math.cos(psi);
    set(f, 15, hx - 0.012, hy); // lWrist
    set(f, 16, hx + 0.012, hy); // rWrist

    // Elbows: between shoulder and hands, biased inward (folding trail arm).
    const lsx = scx - sWidth;
    const rsx = scx + sWidth;
    set(f, 13, lsx + (hx - lsx) * 0.55 + (cx - lsx) * 0.08, shoulderY + (hy - shoulderY) * 0.5);
    set(f, 14, rsx + (hx - rsx) * 0.5 + (cx - rsx) * 0.1, shoulderY + (hy - shoulderY) * 0.55);

    frames.push(f);
  }
  return frames;
}
