import { NextResponse } from "next/server";
import { getChunksForEntry, hasFullAudio } from "@/lib/speak";

// GET /api/sessions/[id]/entries/[entryId]/speak
// Returns how many audio chunks this message's reply will split into (cheap
// — chunking is pure text splitting, no TTS call — computed once and
// cached), plus whether a full (voicemail) file already exists for it — if
// so, Tier-1 playback can just play that directly instead of running its
// own separate chunked synthesis.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  try {
    const chunks = await getChunksForEntry(id, entryId);
    if (!chunks) return NextResponse.json({ error: "Message not found or has no text" }, { status: 404 });
    return NextResponse.json({ chunkCount: chunks.length, fullAudioReady: hasFullAudio(id, entryId) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
