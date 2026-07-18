import { NextResponse } from "next/server";
import { getSelectedVoice, setSelectedVoice } from "@/lib/voice-settings";
import { DESKTOP_HOST } from "@/lib/desktop-host";

const TTS_VOICES_URL = `http://${DESKTOP_HOST}:8880/v1/voices`;

interface VoiceOption {
  id: string;
  description?: string;
}

// GET /api/voice-stack/voice — current selection + the live list of voices
// the TTS server supports (empty options if the TTS server isn't running).
export async function GET() {
  const voice = getSelectedVoice();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    let res: Response;
    try {
      res = await fetch(TTS_VOICES_URL, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return NextResponse.json({ voice, options: [] as VoiceOption[] });
    const data = (await res.json()) as { voices?: VoiceOption[] };
    return NextResponse.json({ voice, options: data.voices ?? [] });
  } catch {
    return NextResponse.json({ voice, options: [] as VoiceOption[] });
  }
}

// POST /api/voice-stack/voice  body: { voice: string }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { voice?: unknown };
    if (typeof body.voice !== "string" || !body.voice) {
      return NextResponse.json({ error: "voice is required" }, { status: 400 });
    }
    setSelectedVoice(body.voice);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
