import { NextResponse } from "next/server";
import { getOrGenerateFullAudio } from "@/lib/speak";

// GET /api/sessions/[id]/entries/[entryId]/speak/full
// One complete audio/wav file for the whole reply — what the voicemail
// Shortcut's "Get Contents of URL" action fetches. Usually already cached
// by the time this is hit (sendVoicemailNotification generates it before
// the notification is even sent), so this is normally an instant cache read.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  try {
    const audio = await getOrGenerateFullAudio(id, entryId);
    if (!audio) return NextResponse.json({ error: "Message not found or has no text" }, { status: 404 });
    return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
