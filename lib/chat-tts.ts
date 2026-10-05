import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getChunksForEntry, getLastAssistantEntryId } from "./speak";
import { DESKTOP_HOST } from "./desktop-host";
import { markChatTtsBusy } from "./chat-runtime";

/**
 * TTS for the /chat voice page (app/chat).
 *
 * Backend policy (same shape as the model policy): the desktop's read-aloud
 * router (speakaloud-tts-router on :8880 — itself local-GGUF-first with its own
 * MiMo fallback) when it answers its health probe; otherwise the MiMo
 * voiceclone endpoint called directly from here. Chunking is pi-web read-aloud
 * Tier-1 (`sanitizeForSpeech` + `chunkText`, 300–500 char chunks) via
 * lib/speak — playback starts on chunk 0 while later chunks synthesize.
 *
 * Caching: single-slot — audio for one message (sessionId:entryId) is kept and
 * dropped the moment another message's audio is requested. That is the spec's
 * "only the last message is cached", enforced server-side so a page reload
 * doesn't lose it.
 */

const TTS_ROUTER_URL = `http://${DESKTOP_HOST}:8880`;
const MIMO_URL = (process.env.MIMO_API_URL || "https://token-plan-sgp.xiaomimimo.com/v1").replace(/\/$/, "");
const MIMO_TTS_MODEL = process.env.MIMO_TTS_MODEL || "mimo-v2.5-tts-voiceclone";
const VOICE = process.env.PI_CHAT_TTS_VOICE || "emma_w";
// Container: /app/voices (read-only mount of /opt/pi-web/data/voices). Desktop
// dev: the live Read-Aloud voice library.
const VOICES_DIR =
  process.env.PI_CHAT_VOICES_DIR ||
  (existsSync("/app/voices") ? "/app/voices" : join(homedir(), "Audio-Visual", "TTS", "voices"));

export interface ChatTtsChunk {
  buf: Buffer;
  mime: string;
}

interface SingleSlotCache {
  key: string;
  chunks: Map<number, ChatTtsChunk>;
}

declare global {
  var __piChatTtsCache: SingleSlotCache | undefined;
}

function cache(): SingleSlotCache {
  if (!globalThis.__piChatTtsCache) globalThis.__piChatTtsCache = { key: "", chunks: new Map() };
  return globalThis.__piChatTtsCache;
}

/** Chunk plan for a session's latest assistant message, or null when there is nothing speakable. */
export async function chatTtsManifest(
  sessionId: string,
): Promise<{ entryId: string; chunkCount: number } | null> {
  const entryId = await getLastAssistantEntryId(sessionId);
  if (!entryId) return null;
  const chunks = await getChunksForEntry(sessionId, entryId);
  if (!chunks || chunks.length === 0) return null;
  return { entryId, chunkCount: chunks.length };
}

/** Synthesize (or return cached) one chunk of the latest message. */
export async function chatTtsChunk(sessionId: string, chunkIndex: number): Promise<ChatTtsChunk | null> {
  const manifest = await chatTtsManifest(sessionId);
  if (!manifest) return null;
  if (chunkIndex < 0 || chunkIndex >= manifest.chunkCount) return null;

  const key = `${sessionId}:${manifest.entryId}`;
  const c = cache();
  if (c.key !== key) {
    c.key = key;
    c.chunks.clear();
  }
  const cached = c.chunks.get(chunkIndex);
  if (cached) return cached;

  const chunks = await getChunksForEntry(sessionId, manifest.entryId);
  if (!chunks) return null;
  const text = chunks[chunkIndex];

  // Synthesis is GPU work on the local backend — flag the session busy so the
  // queued 250k compaction check defers until audio work is done. (busy=true
  // only extends the window; the client's explicit playback busy claim can't
  // be shortened by a later prefetch synthesis.)
  markChatTtsBusy(sessionId, true, 180_000);
  const result = await synthesize(text);
  c.chunks.set(chunkIndex, result);
  return result;
}

async function synthesize(text: string): Promise<ChatTtsChunk> {
  if (await routerHealthy()) {
    const res = await fetch(`${TTS_ROUTER_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: VOICE,
        model: "tts-1-en",
        response_format: "mp3",
        // The router's optimized backend is ~20x faster with stream:true even
        // though we buffer the whole response (see pi-web read-aloud notes).
        stream: true,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`TTS router returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { buf: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
  return synthesizeViaMimo(text);
}

async function routerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_ROUTER_URL}/health`, { signal: AbortSignal.timeout(2_500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Direct MiMo voiceclone — the desktop is unreachable, so the voice reference
 * WAV must be local: <VOICES_DIR>/<voice>.wav, copied from the desktop's
 * ~/Audio-Visual/TTS/voices/. Same request shape as the read-aloud router's own
 * cloud backend (tts_router.py gen_chunk): the reference wav rides along as a
 * base64 data URL per request, and the reply is a base64 WAV at 24 kHz mono.
 */
async function synthesizeViaMimo(text: string): Promise<ChatTtsChunk> {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) throw new Error("MIMO_API_KEY not set and TTS router unreachable");

  const voicePath = join(VOICES_DIR, `${VOICE}.wav`);
  if (!existsSync(voicePath)) {
    throw new Error(`voice reference wav missing: ${voicePath}`);
  }
  const voiceUrl = "data:audio/wav;base64," + readFileSync(voicePath).toString("base64");

  const res = await fetch(`${MIMO_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MIMO_TTS_MODEL,
      messages: [
        { role: "user", content: "" },
        { role: "assistant", content: text },
      ],
      audio: { format: "wav", voice: voiceUrl },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`MiMo TTS returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { message?: { audio?: { data?: string } } }[] };
  const b64 = data.choices?.[0]?.message?.audio?.data;
  if (!b64) throw new Error("MiMo TTS returned no audio");
  return { buf: Buffer.from(b64, "base64"), mime: "audio/wav" };
}
