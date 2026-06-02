"use client";

import { useEffect, useRef } from "react";
import { drawSkeleton, type Frame } from "@/lib/pose";

// Renders a stored pose frame as a small wireframe figure.
export default function PhaseFigure({
  frame,
  label,
  size = 96,
  color = "#22d3ee",
}: {
  frame: Frame | null;
  label: string;
  size?: number;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (!frame) return;
    // Fit the skeleton bounding box into the canvas.
    const xs = frame.map((p) => p.x);
    const ys = frame.map((p) => p.y);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const w = maxX - minX || 1;
    const h = maxY - minY || 1;
    const pad = 0.16;
    const scale = (1 - pad * 2) / Math.max(w, h);
    const offX = (size - w * size * scale) / 2;
    const offY = (size - h * size * scale) / 2;
    const norm = frame.map((p) => ({
      ...p,
      x: ((p.x - minX) * scale * size + offX) / size,
      y: ((p.y - minY) * scale * size + offY) / size,
    }));
    drawSkeleton(ctx, norm, size, size, color);
  }, [frame, size, color]);

  return (
    <div className="flex flex-col items-center">
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: "#0b1220", border: "1px solid var(--line)" }}
      >
        <canvas ref={ref} width={size} height={size} />
      </div>
      <span className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>
        {label}
      </span>
    </div>
  );
}
