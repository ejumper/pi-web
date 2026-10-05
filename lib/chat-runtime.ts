import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "./rpc-manager";
import { allowFileRoot } from "./file-access";
import { resolveDefaultWorkspace } from "./default-workspace";
import { getAgentDir, invalidateSessionListCache } from "./session-reader";
import { DESKTOP_HOST } from "./desktop-host";

/**
 * Server-side runtime for the /chat voice page (app/chat).
 *
 * /chat sessions are ordinary pi sessions in the default workspace (sonar),
 * started through the same in-process AgentSessionWrapper as pi-web, with:
 *   - the voice-chat prompt appended after pi's normal context files
 *     (global AGENTS.md + <sonar>/AGENTS.md stay in play — unlike the desktop
 *     sonar() launcher, which swaps them wholesale),
 *   - the `code` subagent's tool excluded (same setup as sonar),
 *   - a TTS-aware 250k-token compaction check queued after each run (see
 *     maybeCompact below).
 *
 * Model policy (spec): on the first message of a session and on every session
 * reload, probe local/addie — if reachable use it, else the compose-configured
 * default cloud model. A manual pick from the Models popup sticks until the
 * next load.
 */

const LOCAL_MODEL_REF = process.env.PI_CHAT_LOCAL_MODEL || "local/addie";
const DEFAULT_CLOUD_MODEL =
  process.env.PI_CHAT_DEFAULT_CLOUD_MODEL || "xiaomi-token-plan-sgp/mimo-v2.6-flash";
const COMPACT_TOKEN_THRESHOLD = Number(process.env.PI_CHAT_COMPACT_TOKENS || 250_000);

/**
 * Voice-chat specific prompt: the user is hands-free, STT output is imperfect,
 * and answers are heard rather than read.
 */
export const CHAT_SYSTEM_PROMPT = `# Voice chat mode

The user is talking to you by voice, hands-free (often while driving). Two things follow:

1. Speech-to-text is imperfect. The transcript you receive may mishear words — especially technical terms, names, slang, and jargon. Interpret requests charitably: if a word or phrase looks like a plausible mis-transcription of something else, go with the sensible reading instead of the literal one. Only ask a brief clarifying question when the request is genuinely unresolvable.
2. The user LISTENS to your answer — they are not reading it. Every response must be speakable prose:
   - Plain sentences and short paragraphs. No code blocks, no tables, no markdown headers, no bullet lists, no emphasis markers, no links-as-markdown.
   - Lead with the actual answer. Details and caveats come after, briefly.
   - Spell things out naturally: avoid raw URLs, file paths, and identifiers where a plain description works; if you must give one, say it clearly and slowly (e.g. "the file is called config dot json").
   - Keep it as short as the answer allows. Verbosity costs listening time.

These rules apply to the FINAL answer the user hears. Use tools normally for research, but never dump raw tool output or structured data into the answer.`;

/**
 * The voice-chat prompt actually used for new sessions. The live copy lives at
 * ~/.pi/agent/pi-chat-prompt.md (server: the pi-config bind mount
 * /opt/pi-web/data/pi-agent-repo/agent/pi-chat-prompt.md) so it can be edited
 * without rebuilding — read per session creation. The constant above is only
 * the fallback when the file is missing or empty.
 */
export function loadChatPrompt(): string {
  try {
    const text = readFileSync(join(getAgentDir(), "pi-chat-prompt.md"), "utf8").trim();
    if (text) return text;
  } catch {
    /* fall back to the compiled default */
  }
  return CHAT_SYSTEM_PROMPT;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/** The sonar workspace — chat sessions live here (created if missing, and immediately file-browsable). */
export function chatWorkspace(): string {
  const cwd = resolveDefaultWorkspace();
  mkdirSync(cwd, { recursive: true });
  allowFileRoot(cwd);
  return cwd;
}

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

async function addieReachable(): Promise<boolean> {
  try {
    const res = await fetch(`http://${DESKTOP_HOST}:8080/v1/models`, {
      signal: AbortSignal.timeout(2_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function splitModelRef(ref: string): { provider: string; modelId: string } {
  const slash = ref.indexOf("/");
  if (slash === -1) return { provider: ref, modelId: "" };
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

/** local/addie when the desktop model server answers, else the default cloud model. */
export async function pickChatModel(): Promise<{ provider: string; modelId: string }> {
  const ref = (await addieReachable()) ? LOCAL_MODEL_REF : DEFAULT_CLOUD_MODEL;
  return splitModelRef(ref);
}

/** Apply the auto-picked model to a session (the "first message / reload" check). */
export async function applyChatModel(session: AgentSessionWrapper): Promise<{ provider: string; modelId: string }> {
  const model = await pickChatModel();
  await session.send({ type: "set_model", provider: model.provider, modelId: model.modelId });
  return model;
}

// ---------------------------------------------------------------------------
// Per-session chat state (globalThis — survives Next.js dev hot-reload)
// ---------------------------------------------------------------------------

interface ChatSessionState {
  bound: boolean;
  /** Timestamp until which the TTS pipeline (synthesis or playback) is considered busy. 0 = idle. */
  ttsBusyUntil: number;
  checkScheduled: boolean;
  checkAttempts: number;
}

declare global {
  var __piChatSessionStates: Map<string, ChatSessionState> | undefined;
}

function chatState(sessionId: string): ChatSessionState {
  if (!globalThis.__piChatSessionStates) globalThis.__piChatSessionStates = new Map();
  let st = globalThis.__piChatSessionStates.get(sessionId);
  if (!st) {
    st = { bound: false, ttsBusyUntil: 0, checkScheduled: false, checkAttempts: 0 };
    globalThis.__piChatSessionStates.set(sessionId, st);
  }
  return st;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Start (or reuse) the AgentSessionWrapper for a chat session with the chat
 * prompt/tools applied. `sessionId` may be null for a brand-new session and
 * `sessionFile` empty — same convention as /api/agent/new.
 */
export async function ensureChatSession(
  sessionId: string | null,
  sessionFile: string,
): Promise<{ session: AgentSessionWrapper; sessionId: string; fresh: boolean }> {
  const key = sessionId ?? `__chat_new__${Date.now()}`;
  const existed = getRpcSession(key)?.isAlive() ?? false;
  const { session, realSessionId } = await startRpcSession(key, sessionFile, chatWorkspace(), undefined, {
    appendSystemPrompt: [loadChatPrompt()],
    excludeTools: ["code"],
  });
  invalidateSessionListCache();

  const st = chatState(realSessionId);
  if (!st.bound) {
    st.bound = true;
    session.onAgentEnd(() => {
      // Run finished: queue the 250k compaction check behind the TTS phase
      // (the client synthesizes/plays the reply as soon as it sees this) —
      // see maybeCompact.
      st.checkAttempts = 0;
      scheduleCompactionCheck(realSessionId, 5_000);
    });
  }
  return { session, sessionId: realSessionId, fresh: !existed };
}

export function getChatSession(sessionId: string): AgentSessionWrapper | undefined {
  const session = getRpcSession(sessionId);
  return session?.isAlive() ? session : undefined;
}

// ---------------------------------------------------------------------------
// TTS-busy tracking + queued compaction
// ---------------------------------------------------------------------------

/**
 * Called by the TTS route around every synthesis request and by the client on
 * playback start/stop. While busy (or within the grace window), compaction is
 * deferred — local TTS and local/addie share the GPU, and compaction is an LLM
 * call, so it must not land on top of audio synthesis/playback.
 *
 * busy=true only ever EXTENDS the window (a long synthesis must not shorten a
 * playback claim made earlier); busy=false is the explicit release.
 */
export function markChatTtsBusy(sessionId: string, busy: boolean, graceMs = 0): void {
  const st = chatState(sessionId);
  if (busy) {
    st.ttsBusyUntil = Math.max(st.ttsBusyUntil, Date.now() + Math.max(graceMs, 60_000));
  } else {
    st.ttsBusyUntil = 0;
    scheduleCompactionCheck(sessionId, 2_000);
  }
}

const CHECK_RETRY_MS = 30_000;
const CHECK_MAX_ATTEMPTS = 40; // ~20 min of deferral before giving up quietly

export function scheduleCompactionCheck(sessionId: string, delayMs: number): void {
  const st = chatState(sessionId);
  if (st.checkScheduled) return;
  st.checkScheduled = true;
  const timer = setTimeout(() => {
    st.checkScheduled = false;
    void maybeCompact(sessionId);
  }, delayMs);
  // unref: a pending check must never hold the process open on shutdown.
  if (typeof timer.unref === "function") timer.unref();
}

/**
 * The option-B 250k compaction guard: after every run (and after the TTS phase
 * settles), if the projected context is at/over the threshold, run pi's
 * `compact`. pi's own built-in auto-compaction stays enabled as a safety net,
 * but its per-model threshold (contextWindow − reserveTokens) is far above 250k
 * for cloud models, which is exactly the case this check exists for.
 */
async function maybeCompact(sessionId: string): Promise<void> {
  const st = chatState(sessionId);
  const session = getChatSession(sessionId);
  if (!session) return;
  if (st.checkAttempts >= CHECK_MAX_ATTEMPTS) return;

  if (session.isRunning() || Date.now() < st.ttsBusyUntil) {
    st.checkAttempts += 1;
    scheduleCompactionCheck(sessionId, CHECK_RETRY_MS);
    return;
  }

  try {
    const state = (await session.send({ type: "get_state" })) as {
      contextUsage?: { tokens?: number } | null;
    } | null;
    const tokens = state?.contextUsage?.tokens ?? 0;
    if (tokens >= COMPACT_TOKEN_THRESHOLD) {
      await session.send({ type: "compact" });
    }
  } catch (error) {
    console.error("[chat] compaction check failed:", error instanceof Error ? error.message : error);
  }
}
