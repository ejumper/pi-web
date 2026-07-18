import { NextResponse } from "next/server";
import { DESKTOP_HOST } from "@/lib/desktop-host";

const STT_URL = `http://${DESKTOP_HOST}:8890/transcribe`;

// POST /api/transcribe  body: multipart/form-data { audio: Blob }
// Proxies to the local whisper-stt service so the browser never needs
// direct network access to it (matters for the Tailscale/phone setup).
export async function POST(req: Request) {
  try {
    const incoming = await req.formData();
    const audio = incoming.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "audio field is required" }, { status: 400 });
    }

    const forward = new FormData();
    forward.append("audio", audio, "recording");

    const res = await fetch(STT_URL, { method: "POST", body: forward });
    const data = (await res.json()) as { text?: string; error?: string };
    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error ?? `HTTP ${res.status}` }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
