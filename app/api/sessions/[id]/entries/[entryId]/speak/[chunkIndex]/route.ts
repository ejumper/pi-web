import { NextResponse } from "next/server";
import { getChunksForEntry, getCachedAudio, setCachedAudio } from "@/lib/speak";
import { getSelectedVoice } from "@/lib/voice-settings";
import { DESKTOP_HOST } from "@/lib/desktop-host";

const TTS_URL = `http://${DESKTOP_HOST}:8880/v1/audio/speech`;

// GET /api/sessions/[id]/entries/[entryId]/speak/[chunkIndex]
// Synthesizes (or returns cached) audio/mpeg for one chunk of a message's
// reply. Synthesis happens on first request for that chunk and is cached
// in-process — repeat requests (replays, or the client's own prefetch-ahead)
// are instant.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string; chunkIndex: string }> },
) {
  const { id, entryId, chunkIndex: chunkIndexParam } = await params;
  const chunkIndex = Number(chunkIndexParam);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: "Invalid chunk index" }, { status: 400 });
  }

  try {
    const chunks = await getChunksForEntry(id, entryId);
    if (!chunks) return NextResponse.json({ error: "Message not found or has no text" }, { status: 404 });
    if (chunkIndex >= chunks.length) {
      return NextResponse.json({ error: "Chunk index out of range" }, { status: 404 });
    }

    const cached = getCachedAudio(id, entryId, chunkIndex);
    if (cached) {
      return new NextResponse(new Uint8Array(cached), { headers: { "Content-Type": "audio/mpeg" } });
    }

    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: chunks[chunkIndex],
        voice: getSelectedVoice(),
        model: "tts-1-en",
        response_format: "mp3",
        // The TTS server's "optimized" backend has a much faster generation
        // path when streaming — confirmed live: identical text took 76s with
        // stream:false vs 3.7s with stream:true (20x). We still buffer the
        // full stream server-side (res.arrayBuffer() below) and hand the
        // browser one complete mp3 file — stream:true only fixes generation
        // speed, it doesn't change what the client receives.
        stream: true,
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `TTS server returned ${res.status}: ${text}` }, { status: 502 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    setCachedAudio(id, entryId, chunkIndex, buf);
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "audio/mpeg" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
