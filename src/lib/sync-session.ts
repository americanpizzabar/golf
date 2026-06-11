"use client";

import { upload } from "@vercel/blob/client";

// Peer-to-peer sync session for 2-device synchronized recording.
//
// Two transports, chosen automatically:
//  - CONTROL (role / start / stop) and WebRTC signaling: relayed through a
//    polled HTTP mailbox (/api/sync, backed by Neon). A websocket would be
//    lower latency, but the residual start-skew is corrected afterwards by the
//    impact-sound alignment, so short-interval polling is sufficient and keeps
//    the whole stack on Neon (no realtime service).
//  - CLIP (the recorded video): preferred over a direct WebRTC data channel
//    (fast, private, never touches the cloud). If the data channel cannot be
//    established (strict NAT / different networks), the guest falls back to
//    relaying the clip through Vercel Blob, which the host downloads and then
//    deletes.

type Role = "host" | "guest";
export type SyncState = "signaling" | "connecting" | "connected" | "failed" | "closed";
export type Transport = "pending" | "p2p" | "relay";

const POLL_MS = 700;

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
// (symmetric) NAT a TURN relay is needed; supply one via env vars and the data
// channel itself can traverse it, keeping clips on the fast streaming path
// instead of the Blob fallback. TURN is optional.
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

export const hasTurn = !!process.env.NEXT_PUBLIC_TURN_URLS?.trim();

export class SyncSession {
  readonly code: string;
  readonly role: Role;
  private id = Math.random().toString(36).slice(2, 8);
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private h: SyncHandlers;
  private negotiated = false;
  private remoteSet = false;
  private connected = false;
  private dcOpen = false;
  private closed = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private helloTimer: ReturnType<typeof setInterval> | null = null;

  // HTTP polling mailbox state (replaces the Realtime channel).
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeq = 0;
  private polling = false;

  private relayUrls: string[] = []; // Blob URLs this device uploaded (cleanup).

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
    // Begin polling the mailbox for signaling + control messages.
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    this.poll();

    if (this.role === "guest") {
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

  // --- HTTP mailbox (polling) ----------------------------------------------
  private async poll() {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      const res = await fetch(
        `/api/sync?code=${encodeURIComponent(this.code)}&after=${this.lastSeq}&self=${this.id}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        messages?: { seq: number; kind: string; payload: unknown }[];
        last?: number;
      };
      for (const m of json.messages ?? []) {
        if (m.kind === "sig") this.onSignal(m.payload as Signal);
        else if (m.kind === "ctrl") this.onCtrl(m.payload as Record<string, unknown>);
        if (m.seq > this.lastSeq) this.lastSeq = m.seq;
      }
      if (typeof json.last === "number" && json.last > this.lastSeq) this.lastSeq = json.last;
    } catch {
      // Transient network error — the next tick retries.
    } finally {
      this.polling = false;
    }
  }

  private post(kind: "sig" | "ctrl", payload: unknown) {
    fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: this.code, sender: this.id, kind, payload }),
    }).catch(() => {});
  }

  private sendSignal(sig: Signal) {
    this.post("sig", sig);
  }

  private sendCtrl(msg: Record<string, unknown>) {
    this.post("ctrl", { ...msg, from: this.id });
  }

  // Public API used by the page to send role / start / stop commands.
  send(msg: Record<string, unknown>) {
    this.sendCtrl(msg);
  }

  // --- WebRTC signaling (fast-path establishment) --------------------------
  private async onSignal(sig: Signal) {
    const pc = this.pc;
    if (!pc || sig.from === this.id) return;
    try {
      if (this.role === "host" && sig.k === "hello") {
        // A guest is present: the session is usable now (control over mailbox).
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
      // A signaling failure is non-fatal: control still works over the mailbox
      // and the clip can be relayed through Blob.
    }
  }

  private async flushIce() {
    for (const c of this.pendingIce) await this.pc?.addIceCandidate(c).catch(() => {});
    this.pendingIce = [];
  }

  private onCtrl(msg: Record<string, unknown>) {
    if (msg.from === this.id) return;
    const t = msg.t;
    if (t === "__ack") {
      this.markConnected();
      return;
    }
    if (t === "clip-ready") {
      this.receiveRelayClip(String(msg.url), String(msg.kind), String(msg.mime || ""));
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
  // relays through Vercel Blob.
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
    try {
      this.h.onClipProgress?.(kind, 0.02);
      const { url } = await upload(`sync/${this.code}/${this.id}-${Date.now()}.bin`, blob, {
        access: "public",
        handleUploadUrl: "/api/relay/upload",
        contentType: blob.type || "application/octet-stream",
        onUploadProgress: (e) => this.h.onClipProgress?.(kind, Math.max(0.02, e.percentage / 100)),
      });
      this.relayUrls.push(url);
      this.h.onClipProgress?.(kind, 1);
      this.sendCtrl({ t: "clip-ready", kind, url, mime: blob.type });
      // Backstop cleanup in case the host never downloads (e.g. it left).
      setTimeout(() => this.cleanupRelay(), 120_000);
    } catch {
      this.h.onState?.("failed");
    }
  }

  private async receiveRelayClip(url: string, kind: string, mime: string) {
    this.h.onTransport?.("relay");
    this.h.onClipProgress?.(kind, 0.4);
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("download failed");
      const data = await res.blob();
      const blob = mime ? new Blob([data], { type: mime }) : data;
      this.h.onClipProgress?.(kind, 1);
      this.h.onClip?.(kind, blob);
    } catch {
      this.h.onState?.("failed");
      return;
    }
    // The host removes the relayed object as soon as it has it.
    fetch("/api/relay/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => {});
  }

  private cleanupRelay() {
    if (!this.relayUrls.length) return;
    const urls = this.relayUrls;
    this.relayUrls = [];
    for (const url of urls) {
      fetch("/api/relay/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    }
  }

  close() {
    this.closed = true;
    if (this.helloTimer) clearInterval(this.helloTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
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
    this.h.onState?.("closed");
  }
}
