import { getSessionEntries, resolveSessionPath } from "./session-reader";
import { sanitizeForSpeech, chunkText, chunkTextUniform } from "./tts-text";
import { getSelectedVoice } from "./voice-settings";
import { DESKTOP_HOST } from "./desktop-host";
import type { TextContent } from "./types";

const TTS_URL = `http://${DESKTOP_HOST}:8880/v1/audio/speech`;

/**
 * Simple LRU cache with a total-weight cap instead of an entry-count cap —
 * audio chunk sizes vary too much (a Tier-1 chunk vs. a multi-minute
 * voicemail WAV) for "N entries" to mean anything consistent as a memory
 * bound. Recency is tracked via Map's insertion-order (re-inserting a key
 * on read bumps it to "most recent"); eviction pops from the front (oldest)
 * until back under budget.
 */
class BoundedCache<T> {
  private map = new Map<string, T>();
  private totalWeight = 0;

  constructor(private readonly maxWeight: number, private readonly weightOf: (value: T) => number) {}

  get(key: string): T | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value); // bump to most-recently-used
    return value;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: T): void {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      this.totalWeight -= this.weightOf(existing);
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.totalWeight += this.weightOf(value);
    while (this.totalWeight > this.maxWeight && this.map.size > 0) {
      const oldestKey = this.map.keys().next().value as string;
      const oldestValue = this.map.get(oldestKey) as T;
      this.totalWeight -= this.weightOf(oldestValue);
      this.map.delete(oldestKey);
    }
  }
}

const MB = 1024 * 1024;

// In-memory only (no persistence needed — ephemeral chat audio), stored on
// globalThis so it survives Next.js dev hot-reload, same pattern as the
// allowed-roots cache in lib/file-access.ts. Bounded so a long-running
// server can't accumulate audio forever — see pi-audio.md.
declare global {
  var __piSpeakChunksCache: BoundedCache<string[]> | undefined;
  var __piSpeakAudioCache: BoundedCache<Buffer> | undefined;
  var __piSpeakFullAudioCache: BoundedCache<Buffer> | undefined;
}

function chunksCache(): BoundedCache<string[]> {
  // Text, not audio — cap by entry count (weight 1 each) rather than bytes.
  if (!globalThis.__piSpeakChunksCache) globalThis.__piSpeakChunksCache = new BoundedCache<string[]>(500, () => 1);
  return globalThis.__piSpeakChunksCache;
}

function audioCache(): BoundedCache<Buffer> {
  if (!globalThis.__piSpeakAudioCache) globalThis.__piSpeakAudioCache = new BoundedCache<Buffer>(250 * MB, (buf) => buf.length);
  return globalThis.__piSpeakAudioCache;
}

function fullAudioCache(): BoundedCache<Buffer> {
  if (!globalThis.__piSpeakFullAudioCache) globalThis.__piSpeakFullAudioCache = new BoundedCache<Buffer>(250 * MB, (buf) => buf.length);
  return globalThis.__piSpeakFullAudioCache;
}

function isTextBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

/** Raw (unsanitized, unchunked) text of an assistant message's text blocks. */
async function getRawTextForEntry(sessionId: string, entryId: string): Promise<string | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const entry = getSessionEntries(filePath).find((candidate) => candidate.id === entryId);
  if (!entry || entry.type !== "message" || entry.message.role !== "assistant") return null;

  const text = entry.message.content
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n\n");
  return text.trim() ? text : null;
}

/**
 * The entryId of the most recent assistant message with text, for a
 * session — "the plain text final message the model outputs at the end of
 * a run," used by the voicemail notify feature (which has no client-side
 * entryId to work from; it's triggered by the server-side agent_end event).
 */
export async function getLastAssistantEntryId(sessionId: string): Promise<string | null> {
  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const entries = getSessionEntries(filePath);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const hasText = entry.message.content.some((b) => isTextBlock(b) && b.text.trim());
    if (hasText) return entry.id;
    // Keep scanning past assistant entries that are tool-calls-only (no
    // spoken text) — the "final message" is the last one that has any.
  }
  return null;
}

/** Resolve + sanitize + chunk an assistant message's text, cached by session:entry. */
export async function getChunksForEntry(sessionId: string, entryId: string): Promise<string[] | null> {
  const key = `${sessionId}:${entryId}`;
  const cached = chunksCache().get(key);
  if (cached) return cached;

  const text = await getRawTextForEntry(sessionId, entryId);
  if (!text) return null;

  const chunks = chunkText(sanitizeForSpeech(text));
  chunksCache().set(key, chunks);
  return chunks;
}

export function getCachedAudio(sessionId: string, entryId: string, chunkIndex: number): Buffer | undefined {
  return audioCache().get(`${sessionId}:${entryId}:${chunkIndex}`);
}

export function setCachedAudio(sessionId: string, entryId: string, chunkIndex: number, buf: Buffer): void {
  audioCache().set(`${sessionId}:${entryId}:${chunkIndex}`, buf);
}

function buildWavHeader(pcmLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

/**
 * Whether a full (voicemail) audio file already exists for this entry,
 * without triggering generation if it doesn't — lets Tier-1 playback (the
 * "Read" button) check whether it can just play that instead of running its
 * own separate chunked synthesis.
 */
export function hasFullAudio(sessionId: string, entryId: string): boolean {
  return fullAudioCache().has(`${sessionId}:${entryId}`);
}

/**
 * One complete audio file for an entire reply — for the voicemail feature,
 * not Tier-1 playback. No pipelining to protect here (generated fully in
 * the background before anything gets served), so chunks use read-aloud.sh's
 * own larger ~2000-char sizing, and raw PCM is concatenated chunk-to-chunk
 * (lossless, no mp3-frame/ID3 boundary concerns) before being wrapped in a
 * single WAV header. Cached whole so repeat requests (a slow tap of the
 * notification, or a retry) are instant.
 */
export async function getOrGenerateFullAudio(sessionId: string, entryId: string): Promise<Buffer | null> {
  const key = `${sessionId}:${entryId}`;
  const cached = fullAudioCache().get(key);
  if (cached) return cached;

  const text = await getRawTextForEntry(sessionId, entryId);
  if (!text) return null;

  const chunks = chunkTextUniform(sanitizeForSpeech(text));
  if (chunks.length === 0) return null;

  const voice = getSelectedVoice();
  const pcmParts: Buffer[] = [];
  for (const chunk of chunks) {
    const res = await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: chunk,
        voice,
        model: "tts-1-en",
        response_format: "pcm",
        stream: true,
        temperature: 0.4,
      }),
    });
    if (!res.ok) throw new Error(`TTS server returned ${res.status}: ${await res.text()}`);
    pcmParts.push(Buffer.from(await res.arrayBuffer()));
  }

  const pcm = Buffer.concat(pcmParts);
  const wav = Buffer.concat([buildWavHeader(pcm.length), pcm]);
  fullAudioCache().set(key, wav);
  return wav;
}
