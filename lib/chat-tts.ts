import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { buildWavHeader, getChunksForEntry, getLastAssistantEntryId } from "./speak";
import { DESKTOP_HOST } from "./desktop-host";
import { markChatTtsBusy } from "./chat-runtime";

/**
 * TTS for the /chat voice page (app/chat).
 *
 * Backend policy, tried in order. Chunking is pi-web read-aloud Tier-1
 * (`sanitizeForSpeech` + `chunkText`, 300–500 char chunks) via lib/speak and
 * happens HERE — one whole chunk per request — so a backend swap mid-message
 * is seamless; playback starts on chunk 0 while later chunks synthesize.
 *   1. Server2's GPU piper twin — same server.py/en_US-addie as the server's
 *      own container, synthesized on its 1050 Ti; reached via its nginx ingress.
 *   2. The server's own piper-tts container (CPU, same baked-in voice).
 *   3. The desktop's read-aloud router (:8880 — custom voices via the Voice
 *      popup). Deliberately last: effectively dormant, kept in code so the
 *      custom-voice path is one reorder away if it's ever wanted back.
 *
 * Caching: single-slot — audio for one message (sessionId:entryId) is kept and
 * dropped the moment another message's audio is requested. That is the spec's
 * "only the last message is cached", enforced server-side so a page reload
 * doesn't lose it.
 */

const TTS_ROUTER_URL = `http://${DESKTOP_HOST}:8880`;
// Tier 1 — Server2's GPU piper twin (/opt/piper-tts on the tts box): same
// server.py and en_US-addie voice as the server's own, synthesized on a
// 1050 Ti. The container binds loopback-only there, so nginx on the tailnet
// IP is the only way in — the /piper/ prefix is part of the contract.
const SERVER2_PIPER_URL = (process.env.PI_CHAT_TTS_SERVER2_URL || "http://100.75.135.87").replace(/\/$/, "");
// Tier 2 — the server's own piper container (/opt/piper-tts). It publishes on
// the server's loopback AND the server's tailnet IP — the tailnet address is
// the one that works from every pi-web deployment (this container and the
// desktop service), so it is the default. `host.docker.internal` is NOT an
// alternative: piper's loopback publish is invisible to containers, because
// host-gateway resolves to the docker bridge gateway, not to the host's
// loopback.
const PIPER_URL = (process.env.PI_CHAT_TTS_FALLBACK_URL || "http://100.93.215.27:8900").replace(/\/$/, "");
const PIPER_SAMPLE_RATE = 22050;
const VOICE_SETTINGS_PATH = join(homedir(), ".pi", "agent", "pi-chat-voice.json");
// Compose env is the FALLBACK — a voice picked in the UI persists to
// pi-chat-voice.json (next to pi's own config) and wins until changed.
const DEFAULT_VOICE = process.env.PI_CHAT_TTS_VOICE || "emma_w";
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

/** Voice names from the shared wav library (same dir for the local server and the MiMo voiceclone fallback). */
export function listChatVoices(): string[] {
  try {
    return readdirSync(VOICES_DIR)
      .filter((f) => f.toLowerCase().endsWith(".wav"))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

export function getChatVoice(): string {
  try {
    if (existsSync(VOICE_SETTINGS_PATH)) {
      const data = JSON.parse(readFileSync(VOICE_SETTINGS_PATH, "utf8")) as { voice?: string };
      if (data.voice) return data.voice;
    }
  } catch {
    /* fall through to the compose default */
  }
  return DEFAULT_VOICE;
}

/** Persist the picked voice. Returns false when the wav doesn't exist. */
export function setChatVoice(voice: string): boolean {
  if (!listChatVoices().includes(voice)) return false;
  writeFileSync(VOICE_SETTINGS_PATH, JSON.stringify({ voice }, null, 2));
  // Cached audio was synthesized in the old voice — drop it so replays
  // regenerate in the new one.
  const c = cache();
  c.key = "";
  c.chunks.clear();
  return true;
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
  const result = await synthesize(text, getChatVoice());
  c.chunks.set(chunkIndex, result);
  return result;
}

async function synthesize(text: string, voice: string): Promise<ChatTtsChunk> {
  const failures: string[] = [];
  // Tiers 1+2: the two piper deployments — identical contract (same server.py;
  // /chat chunking happens here anyway, one whole chunk per request), so
  // failover between them is seamless.
  for (const [label, base] of [
    ["Server2 piper (GPU)", `${SERVER2_PIPER_URL}/piper`],
    ["local piper", PIPER_URL],
  ] as const) {
    try {
      if (!(await piperHealthy(base))) throw new Error("health probe failed");
      return await piperSpeech(base, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[chat-tts] ${label} unavailable (${msg})`);
      failures.push(`${label}: ${msg}`);
    }
  }
  // Tier 3: the desktop's read-aloud router — deliberately last, effectively
  // dormant. The only path that honors the Voice popup (piper's voice is
  // baked into the model), kept so custom voices are one reorder away.
  try {
    if (!(await routerHealthy())) throw new Error("health probe failed");
    return await routerSpeech(text, voice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[chat-tts] desktop router unavailable (${msg})`);
    failures.push(`desktop router: ${msg}`);
  }
  throw new Error(`no TTS backend answered — ${failures.join("; ")}`);
}

/** Fast liveness check so a dead backend costs 2.5s, not a hung POST. */
async function piperHealthy(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2_500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** The desktop's read-aloud router (tier 3): raw-PCM stream, normalized to WAV below. */
async function routerSpeech(text: string, voice: string): Promise<ChatTtsChunk> {
  const res = await fetch(`${TTS_ROUTER_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      voice,
      model: "tts-1-en",
      // response_format is effectively ignored by the router's local backend:
      // it always streams raw PCM s16le 24 kHz mono ("mp3" gets the same,
      // just with a different (wrong) content-type label). So ask for "pcm"
      // and normalize ourselves — see normalization below.
      response_format: "pcm",
      // The router's optimized backend is ~20x faster with stream:true even
      // though we buffer the whole response (see pi-web read-aloud notes).
      stream: true,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`TTS router returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = Buffer.from(await res.arrayBuffer());
  // Normalize to a real WAV file: if the body already carries a RIFF header
  // pass it through, otherwise wrap the raw PCM in one. The client always
  // receives valid audio/wav — raw PCM mislabeled as mp3 was the silent-
  // playback bug this normalization exists for.
  const isWav = raw.length > 44 && raw.toString("ascii", 0, 4) === "RIFF";
  return { buf: isWav ? raw : Buffer.concat([buildWavHeader(raw.length), raw]), mime: "audio/wav" };
}

/**
 * Piper (tiers 1+2) — POST one chunk to a piper deployment. Same request shape
 * as the router (`input` only); `voice` is deliberately not sent: piper's
 * voice is baked into the model on both deployments (en_US-addie) and the
 * param is accepted-and-ignored there, so the Voice popup only has an effect
 * on the router path. Reply is real WAV, 22.05 kHz mono s16le — passed
 * through as-is, with the same defensive header wrap the router path uses in
 * case a deployment ever returns bare PCM.
 */
async function piperSpeech(base: string, text: string): Promise<ChatTtsChunk> {
  const res = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: text, response_format: "wav" }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`piper TTS returned ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length === 0) throw new Error("piper TTS returned no audio");
  const isWav = raw.length > 44 && raw.toString("ascii", 0, 4) === "RIFF";
  return {
    buf: isWav ? raw : Buffer.concat([buildWavHeader(raw.length, PIPER_SAMPLE_RATE), raw]),
    mime: "audio/wav",
  };
}

async function routerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_ROUTER_URL}/health`, { signal: AbortSignal.timeout(2_500) });
    return res.ok;
  } catch {
    return false;
  }
}
