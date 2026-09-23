import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// STT via MiMo ASR (mimo-v2.5-asr) — cloud, batch upload, no local whisper.
// Browsers record webm/opus (Chrome/Android) or mp4/aac (iOS Safari); MiMo
// only accepts wav/mpeg/mp3 (verified: audio/webm → 400), so everything is
// transcoded to 16 kHz mono wav with ffmpeg first (same format the dictation
// daemon feeds it).
// Request shape identical to ~/Audio-Visual/STT/dictate/backends/mimo.py:
// text goes in a user-role input_audio content part, asr_options carries the
// language. The model nondeterministically leaks control-tag fragments
// ("<chinese>", "think>") even with bare requests — scrubbed below, mirroring
// dictate/postprocess.py's always-on filter.
// Key: MIMO_API_KEY env — this deployment's own copy (not shared with the
// desktop's STT/TTS backends.conf files).

const MIMO_URL =
  process.env.MIMO_API_URL || "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions";
const MODEL = "mimo-v2.5-asr";
const MIMO_TIMEOUT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 20_000;
const MAX_UPLOAD_BYTES = 25_000_000;

// whole whitespace-delimited token shaped like [optional <][optional /]word> —
// e.g. "<chinese>", "think>", "</think>". Real prose tokens ("5>", "ok") don't match.
const TAG_TOKEN = /^<?\/?[A-Za-z][A-Za-z0-9_/-]*>$/;

function scrubTags(text: string): string {
  return text
    .split(/\s+/)
    .filter((t) => t && !TAG_TOKEN.test(t))
    .join(" ")
    .trim();
}

function extFor(mime: string): string {
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mp4") || mime.includes("aac")) return ".mp4";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("wav")) return ".wav";
  return ".bin";
}

export const runtime = "nodejs"; // ffmpeg via child_process

export async function POST(req: Request) {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "MIMO_API_KEY not set" }, { status: 503 });
  }

  let dir: string | null = null;
  try {
    const incoming = await req.formData();
    const audio = incoming.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json({ error: "audio field is required" }, { status: 400 });
    }
    if (audio.size === 0) {
      return NextResponse.json({ error: "empty recording" }, { status: 400 });
    }
    if (audio.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "recording too large" }, { status: 413 });
    }

    // ── transcode whatever the browser gave us to 16 kHz mono wav ──
    dir = await mkdtemp(join(tmpdir(), "piweb-stt-"));
    const inPath = join(dir, "in" + extFor(audio.type || ""));
    const wavPath = join(dir, "out.wav");
    await writeFile(inPath, Buffer.from(await audio.arrayBuffer()));
    await execFileP(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", inPath, "-ar", "16000", "-ac", "1", "-f", "wav", "-y", wavPath],
      { timeout: FFMPEG_TIMEOUT_MS },
    );
    const wav = await readFile(wavPath);

    // ── MiMo ASR ──
    const body = {
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: "data:audio/wav;base64," + wav.toString("base64") },
            },
          ],
        },
      ],
      asr_options: { language: "en" },
    };
    const res = await fetch(MIMO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(MIMO_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string } | string;
    };
    if (!res.ok) {
      const msg = typeof data.error === "string" ? data.error : data.error?.message;
      return NextResponse.json(
        { error: msg ?? `transcription failed (HTTP ${res.status})` },
        { status: 502 },
      );
    }
    const text = scrubTags(data.choices?.[0]?.message?.content ?? "");
    if (!text) {
      return NextResponse.json({ error: "no speech recognized" }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (error) {
    const msg = String(error);
    return NextResponse.json(
      { error: msg.includes("timeout") || msg.includes("abort") ? "transcription timed out" : msg },
      { status: 500 },
    );
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
