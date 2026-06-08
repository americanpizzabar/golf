"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Peer-to-peer sync session for 2-device synchronized recording. Supabase
// Realtime broadcast is used ONLY as the WebRTC signaling channel (SDP + ICE
// handshake) — no database tables, no storage. Once the RTCDataChannel opens,
// record commands and the recorded clip itself flow directly device-to-device,
// so no video ever touches the cloud.

type Role = "host" | "guest";
export type SyncState = "signaling" | "connecting" | "connected" | "failed" | "closed";

interface Signal {
  k: "hello" | "offer" | "answer" | "ice";
  from: string;
  sdp?: RTCSessionDescriptionInit;
  cand?: RTCIceCandidateInit;
}

export interface SyncHandlers {
  onState?: (s: SyncState) => void;
  onMessage?: (msg: Record<string, unknown>) => void;
  onClipProgress?: (kind: string, p: number) => void;
  onClip?: (kind: string, blob: Blob) => void;
}

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export class SyncSession {
  readonly code: string;
  readonly role: Role;
  private id = Math.random().toString(36).slice(2, 8);
  private ch: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private h: SyncHandlers;
  private negotiated = false;
  private remoteSet = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private helloTimer: ReturnType<typeof setInterval> | null = null;

  // Incoming clip reassembly.
  private rxChunks: ArrayBuffer[] = [];
  private rxMeta: { size: number; mime: string; kind: string } | null = null;
  private rxReceived = 0;

  constructor(code: string, role: Role, handlers: SyncHandlers) {
    this.code = code;
    this.role = role;
    this.h = handlers;
  }

  async start() {
    this.setupPeer();
    const ch = supabase.channel(`sync-${this.code}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "sig" }, ({ payload }) => this.onSignal(payload as Signal));
    await ch.subscribe((status) => {
      if (status === "SUBSCRIBED" && this.role === "guest") {
        // The guest announces itself; retry until the host picks it up.
        this.sendSignal({ k: "hello", from: this.id });
        this.helloTimer = setInterval(() => {
          if (this.negotiated) {
            if (this.helloTimer) clearInterval(this.helloTimer);
            this.helloTimer = null;
          } else {
            this.sendSignal({ k: "hello", from: this.id });
          }
        }, 1500);
      }
    });
    this.ch = ch;
    this.h.onState?.("signaling");
  }

  private setupPeer() {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ k: "ice", from: this.id, cand: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connecting") this.h.onState?.("connecting");
      else if (st === "failed") this.h.onState?.("failed");
    };
    if (this.role === "host") {
      this.bindDc(pc.createDataChannel("clip", { ordered: true }));
    } else {
      pc.ondatachannel = (e) => this.bindDc(e.channel);
    }
    this.pc = pc;
  }

  private bindDc(dc: RTCDataChannel) {
    dc.binaryType = "arraybuffer";
    dc.onopen = () => this.h.onState?.("connected");
    dc.onclose = () => this.h.onState?.("closed");
    dc.onmessage = (e) => this.onDcMessage(e.data);
    this.dc = dc;
  }

  private async onSignal(sig: Signal) {
    const pc = this.pc;
    if (!pc || sig.from === this.id) return;
    try {
      if (this.role === "host" && sig.k === "hello") {
        if (this.negotiated) return;
        this.negotiated = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal({ k: "offer", from: this.id, sdp: offer });
      } else if (this.role === "guest" && sig.k === "offer" && sig.sdp) {
        this.negotiated = true;
        await pc.setRemoteDescription(sig.sdp);
        this.remoteSet = true;
        await this.flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.sendSignal({ k: "answer", from: this.id, sdp: answer });
      } else if (this.role === "host" && sig.k === "answer" && sig.sdp) {
        await pc.setRemoteDescription(sig.sdp);
        this.remoteSet = true;
        await this.flushIce();
      } else if (sig.k === "ice" && sig.cand) {
        if (this.remoteSet) await pc.addIceCandidate(sig.cand).catch(() => {});
        else this.pendingIce.push(sig.cand);
      }
    } catch {
      this.h.onState?.("failed");
    }
  }

  private async flushIce() {
    for (const c of this.pendingIce) await this.pc?.addIceCandidate(c).catch(() => {});
    this.pendingIce = [];
  }

  private sendSignal(sig: Signal) {
    this.ch?.send({ type: "broadcast", event: "sig", payload: sig });
  }

  // Send a small JSON control message over the data channel.
  send(msg: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
  }

  private onDcMessage(data: string | ArrayBuffer) {
    if (typeof data === "string") {
      const msg = JSON.parse(data) as Record<string, unknown>;
      if (msg.t === "clip-meta") {
        this.rxChunks = [];
        this.rxReceived = 0;
        this.rxMeta = { size: Number(msg.size), mime: String(msg.mime), kind: String(msg.kind) };
      } else if (msg.t === "clip-end") {
        if (this.rxMeta) {
          const blob = new Blob(this.rxChunks, { type: this.rxMeta.mime || "video/webm" });
          const kind = this.rxMeta.kind;
          this.rxChunks = [];
          this.rxMeta = null;
          this.h.onClip?.(kind, blob);
        }
      } else {
        this.h.onMessage?.(msg);
      }
    } else if (this.rxMeta) {
      this.rxChunks.push(data);
      this.rxReceived += data.byteLength;
      this.h.onClipProgress?.(
        this.rxMeta.kind,
        this.rxMeta.size ? this.rxReceived / this.rxMeta.size : 0,
      );
    }
  }

  // Stream a recorded clip to the peer in chunks, with backpressure handling.
  async sendClip(kind: string, blob: Blob) {
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") return;
    const buf = await blob.arrayBuffer();
    const CHUNK = 16 * 1024;
    dc.bufferedAmountLowThreshold = 256 * 1024;
    this.send({ t: "clip-meta", size: buf.byteLength, mime: blob.type, kind });
    let offset = 0;
    while (offset < buf.byteLength) {
      if (dc.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise<void>((res) => {
          const on = () => {
            dc.removeEventListener("bufferedamountlow", on);
            res();
          };
          dc.addEventListener("bufferedamountlow", on);
        });
      }
      dc.send(buf.slice(offset, Math.min(offset + CHUNK, buf.byteLength)));
      offset = Math.min(offset + CHUNK, buf.byteLength);
      this.h.onClipProgress?.(kind, offset / buf.byteLength);
    }
    this.send({ t: "clip-end" });
  }

  close() {
    if (this.helloTimer) clearInterval(this.helloTimer);
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    if (this.ch) supabase.removeChannel(this.ch);
    this.ch = null;
    this.h.onState?.("closed");
  }
}
