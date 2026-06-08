"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Peer-to-peer sync session for 2-device synchronized recording.
//
// Two transports, chosen automatically:
//  - CONTROL (role / start / stop): always sent over Supabase Realtime
//    broadcast. A websocket hop is low-latency enough to start both phones
//    together, and the residual skew is corrected later by impact-sound sync.
//    This means the session works even if the direct peer connection never
//    forms.
//  - CLIP (the recorded video): preferred over a direct WebRTC data channel
//    (fast, private, never touches the cloud). If the data channel cannot be
//    established (strict NAT / different networks), the guest falls back to
//    relaying the clip through a transient Supabase Storage object, which the
//    host downloads and then deletes.
//
// Realtime broadcast is also the WebRTC signaling channel (SDP + ICE).

type Role = "host" | "guest";
export type SyncState = "signaling" | "connecting" | "connected" | "failed" | "closed";
export type Transport = "pending" | "p2p" | "relay";

const RELAY_BUCKET = "sync-clips";

interface Signal {
  k: "hello" | "offer" | "answer" | "ice";
  from: string;
  sdp?: RTCSessionDescriptionInit;
  cand?: RTCIceCandidateInit;
}

export interface SyncHandlers {
  onState?: (s: SyncState) => void;
  onTransport?: (t: Transport) => void;
  onMessage?: (msg: Record<string, unknown>) => void;
  onClipProgress?: (kind: string, p: number) => void;
  onClip?: (kind: string, blob: Blob) => void;
}

// ICE servers. Public STUN handles most home/office NATs. For strict
// (symmetric) NAT — common on mobile carriers / corporate Wi-Fi — a direct
// peer connection needs a TURN relay; supply one via env vars and the data
// channel itself can traverse it, keeping clips on the fast streaming path
// instead of the storage fallback. TURN is optional: without it the app still
// works (control over Realtime, clips over the storage relay).
//
//   NEXT_PUBLIC_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
//   NEXT_PUBLIC_TURN_USERNAME=...
//   NEXT_PUBLIC_TURN_CREDENTIAL=...
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrls = process.env.NEXT_PUBLIC_TURN_URLS?.trim();
  if (turnUrls) {
    servers.push({
      urls: turnUrls.split(",").map((u) => u.trim()).filter(Boolean),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

const ICE: RTCConfiguration = { iceServers: buildIceServers() };

// True when a TURN relay is configured (used only for UI/telemetry hints).
export const hasTurn = !!process.env.NEXT_PUBLIC_TURN_URLS?.trim();

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
  private connected = false;
  private dcOpen = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private relayPaths: string[] = []; // objects this device uploaded (for cleanup)

  // Incoming clip reassembly (data-channel fast path).
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
    ch.on("broadcast", { event: "ctrl" }, ({ payload }) => this.onCtrl(payload as Record<string, unknown>));
    await ch.subscribe((status) => {
      if (status === "SUBSCRIBED" && this.role === "guest") {
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
    this.h.onTransport?.("pending");
  }

  private setupPeer() {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ k: "ice", from: this.id, cand: e.candidate.toJSON() });
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
    dc.onopen = () => {
      this.dcOpen = true;
      this.markConnected();
      this.h.onTransport?.("p2p");
    };
    dc.onclose = () => {
      this.dcOpen = false;
    };
    dc.onmessage = (e) => this.onDcMessage(e.data);
    this.dc = dc;
  }

  private markConnected() {
    if (this.connected) return;
    this.connected = true;
    this.h.onState?.("connected");
  }

  // --- WebRTC signaling (fast-path establishment) --------------------------
  private async onSignal(sig: Signal) {
    const pc = this.pc;
    if (!pc || sig.from === this.id) return;
    try {
      if (this.role === "host" && sig.k === "hello") {
        // A guest is present: the session is usable now (control over Realtime).
        this.markConnected();
        this.sendCtrl({ t: "__ack" });
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
      // A signaling failure is non-fatal: control still works over Realtime
      // and the clip can be relayed through storage.
    }
  }

  private async flushIce() {
    for (const c of this.pendingIce) await this.pc?.addIceCandidate(c).catch(() => {});
    this.pendingIce = [];
  }

  private sendSignal(sig: Signal) {
    this.ch?.send({ type: "broadcast", event: "sig", payload: sig });
  }

  // --- Control channel (always over Realtime) ------------------------------
  private sendCtrl(msg: Record<string, unknown>) {
    this.ch?.send({ type: "broadcast", event: "ctrl", payload: { ...msg, from: this.id } });
  }

  // Public API used by the page to send role / start / stop commands.
  send(msg: Record<string, unknown>) {
    this.sendCtrl(msg);
  }

  private onCtrl(msg: Record<string, unknown>) {
    if (msg.from === this.id) return;
    const t = msg.t;
    if (t === "__ack") {
      this.markConnected();
      return;
    }
    if (t === "clip-ready") {
      this.receiveRelayClip(String(msg.path), String(msg.kind), String(msg.mime || ""));
      return;
    }
    this.h.onMessage?.(msg);
  }

  // --- Data-channel clip path ---------------------------------------------
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

  // Send a recorded clip to the peer. Uses the data channel if open, otherwise
  // relays through Supabase Storage.
  async sendClip(kind: string, blob: Blob) {
    if (this.dcOpen && this.dc?.readyState === "open") {
      this.h.onTransport?.("p2p");
      await this.sendClipOverDc(kind, blob);
    } else {
      this.h.onTransport?.("relay");
      await this.sendClipOverRelay(kind, blob);
    }
  }

  private async sendClipOverDc(kind: string, blob: Blob) {
    const dc = this.dc!;
    const buf = await blob.arrayBuffer();
    const CHUNK = 16 * 1024;
    dc.bufferedAmountLowThreshold = 256 * 1024;
    this.send_dc({ t: "clip-meta", size: buf.byteLength, mime: blob.type, kind });
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
      const next = Math.min(offset + CHUNK, buf.byteLength);
      dc.send(buf.slice(offset, next));
      offset = next;
      this.h.onClipProgress?.(kind, offset / buf.byteLength);
    }
    this.send_dc({ t: "clip-end" });
  }

  private send_dc(msg: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
  }

  private async sendClipOverRelay(kind: string, blob: Blob) {
    const path = `${this.code}/${this.id}-${Date.now()}.bin`;
    this.h.onClipProgress?.(kind, 0.05);
    const { error } = await supabase.storage
      .from(RELAY_BUCKET)
      .upload(path, blob, { contentType: blob.type || "application/octet-stream", upsert: true });
    if (error) {
      this.h.onState?.("failed");
      return;
    }
    this.relayPaths.push(path);
    this.h.onClipProgress?.(kind, 1);
    this.sendCtrl({ t: "clip-ready", kind, path, mime: blob.type });
    // Backstop cleanup in case the host never downloads (e.g. it left).
    setTimeout(() => this.cleanupRelay(), 120_000);
  }

  private async receiveRelayClip(path: string, kind: string, mime: string) {
    this.h.onTransport?.("relay");
    this.h.onClipProgress?.(kind, 0.5);
    const { data, error } = await supabase.storage.from(RELAY_BUCKET).download(path);
    if (error || !data) {
      this.h.onState?.("failed");
      return;
    }
    const blob = mime ? new Blob([data], { type: mime }) : data;
    this.h.onClipProgress?.(kind, 1);
    this.h.onClip?.(kind, blob);
    // The host removes the relayed object as soon as it has it.
    await supabase.storage.from(RELAY_BUCKET).remove([path]).catch(() => {});
  }

  private async cleanupRelay() {
    if (!this.relayPaths.length) return;
    const paths = this.relayPaths;
    this.relayPaths = [];
    await supabase.storage.from(RELAY_BUCKET).remove(paths).catch(() => {});
  }

  close() {
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.cleanupRelay();
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
