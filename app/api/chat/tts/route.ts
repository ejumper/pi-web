import { NextResponse } from "next/server";
import { chatTtsChunk, chatTtsManifest } from "@/lib/chat-tts";
import { markChatTtsBusy } from "@/lib/chat-runtime";

export const runtime = "nodejs";

// GET  /api/chat/tts?session=<id>              → { entryId, chunkCount }
// GET  /api/chat/tts?session=<id>&chunk=<n>    → audio/mpeg | audio/wav for one chunk
// POST /api/chat/tts  { session, busy }        → playback busy claim/release
//
// Single-slot cache semantics live in lib/chat-tts: only the latest message's
// audio survives; requesting another message's audio drops it.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) return NextResponse.json({ error: "session is required" }, { status: 400 });

  try {
    const chunkParam = url.searchParams.get("chunk");
    if (chunkParam === null) {
      const manifest = await chatTtsManifest(sessionId);
      if (!manifest) return NextResponse.json({ error: "Nothing speakable" }, { status: 404 });
      return NextResponse.json(manifest);
    }

    const chunkIndex = Number(chunkParam);
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
      return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
    }

    const chunk = await chatTtsChunk(sessionId, chunkIndex);
    if (!chunk) return NextResponse.json({ error: "Chunk not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(chunk.buf), {
      headers: { "Content-Type": chunk.mime, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { session?: string; busy?: boolean };
    if (!body.session) return NextResponse.json({ error: "session is required" }, { status: 400 });
    // Playback claim: up to 15 min, extended by synthesis calls as needed;
    // released explicitly when playback ends/stops.
    markChatTtsBusy(body.session, body.busy === true, 15 * 60_000);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
