import { NextResponse } from "next/server";
import { getChatVoice, listChatVoices, setChatVoice } from "@/lib/chat-tts";

export const runtime = "nodejs";

// GET  /api/chat/voices → { voices: string[], current: string }
// POST /api/chat/voices  { voice } → persist the pick (wins over the compose
// default until changed) and drop cached TTS audio synthesized in the old
// voice. 400 when the wav doesn't exist in the shared voice library.

export async function GET() {
  try {
    return NextResponse.json({ voices: listChatVoices(), current: getChatVoice() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { voice?: string };
    if (!body.voice) return NextResponse.json({ error: "voice is required" }, { status: 400 });
    if (!setChatVoice(body.voice)) {
      return NextResponse.json({ error: `unknown voice: ${body.voice}` }, { status: 400 });
    }
    return NextResponse.json({ voice: body.voice });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
