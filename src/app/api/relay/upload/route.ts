import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

// Issues short-lived upload tokens so the GUEST device can stream its recorded
// clip DIRECTLY to Vercel Blob (bypassing the 4.5 MB serverless body limit).
// Used only as the fallback when the WebRTC data channel can't be established;
// the clip is downloaded by the host and deleted right after hand-off.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/webm", "application/octet-stream"],
        maximumSizeInBytes: 300 * 1024 * 1024,
        addRandomSuffix: true,
        // Transient relay objects; expire automatically as a backstop.
        validUntil: Date.now() + 30 * 60 * 1000,
      }),
      onUploadCompleted: async () => {
        // Nothing to persist — the host fetches the URL from the signaling
        // message and deletes it afterwards.
      },
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/relay/upload]", e);
    return NextResponse.json({ error: "upload token failed" }, { status: 500 });
  }
}
