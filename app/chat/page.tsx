"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import { Popup } from "@/components/chat/Popup";
import {
  attachments as attachmentsIcon,
  models as modelsIcon,
  newSession as newSessionIcon,
  sessions as sessionsIcon,
  voice as voiceIcon,
} from "./icons";
import "./chat.css";

/**
 * /chat — hands-free voice chat with pi (record → transcribe → pi → TTS).
 *
 * Interaction model (spec):
 *  - double-tap anywhere (except scrollable/interactive areas) toggles
 *    recording; single tap pauses/resumes it; long-press (1s) cancels
 *  - double-tap while recording stops and sends the prompt
 *  - edge glow: red = recording, white = talking to the model (arc =
 *    connecting, pulse = working), green = TTS (arc = synthesizing, pulse =
 *    playing — amplitude-synced to the speech when Web Audio is available)
 *  - single tap pauses/resumes TTS, long-press stops it, long-press again
 *    replays the last reply
 */

type Phase =
  | "idle"
  | "recording"
  | "recording_paused"
  | "connecting"
  | "working"
  | "tts_connecting"
  | "tts_playing"
  | "tts_paused";

interface ModelRow {
  id: string;
  name: string;
  provider: string;
}
interface SessionRow {
  id: string;
  name: string;
  modified: string;
}
interface StagedFile {
  file: File;
  isImage: boolean;
}

const GLOW_COLORS: Record<"red" | "white" | "green", string> = {
  red: "#ff453a",
  white: "#f2f2f7",
  green: "#32d74b",
};

const MAX_RECORD_MS = 5 * 60_000; // hard cap
const MAX_SILENCE_MS = 60_000; // silence auto-stop (same as pi-web mic)
const SILENCE_RMS = 0.02;
const DOUBLE_TAP_MS = 320;
const LONG_PRESS_MS = 1000;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i;

// Minimal valid silent WAV (44-byte header, no samples) — played once from
// inside a user gesture to unlock later programmatic playback in browsers
// with strict autoplay blocking (Brave, Safari).
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

function glowFor(phase: Phase, ampAvailable: boolean): { color: keyof typeof GLOW_COLORS; mode: string } {
  switch (phase) {
    case "recording":
      return { color: "red", mode: "pulse" };
    case "recording_paused":
      return { color: "red", mode: "steady" };
    case "connecting":
      return { color: "white", mode: "arc" };
    case "working":
      return { color: "white", mode: "pulse" };
    case "tts_connecting":
      return { color: "green", mode: "arc" };
    case "tts_playing":
      return { color: "green", mode: ampAvailable ? "audio" : "pulse" };
    case "tts_paused":
      return { color: "green", mode: "steady" };
    default:
      return { color: "white", mode: "off" };
  }
}

// Minimal localStorage cache (stale-while-revalidate): on a slow link the
// sessions list, models, voices and opened conversations render instantly
// from cache while fresh copies load in the background.
const CACHE_PREFIX = "pi-chat:";
const CONVO_TEXT_CAP = 20_000;
const CONVO_KEEP = 20;

function readCacheValue<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as { v: T }).v : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
    if (key.startsWith("convo:")) pruneConvos();
  } catch {
    /* quota/private mode — caching is best-effort */
  }
}

function pruneConvos(): void {
  const entries: Array<{ key: string; t: number }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX + "convo:")) continue;
    try {
      const t = (JSON.parse(localStorage.getItem(key) ?? "") as { t?: number }).t ?? 0;
      entries.push({ key, t });
    } catch {
      /* ignore malformed */
    }
  }
  entries.sort((a, b) => b.t - a.t);
  for (const stale of entries.slice(CONVO_KEEP)) localStorage.removeItem(stale.key);
}

export default function ChatPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [activity, setActivity] = useState("");
  const [responseText, setResponseText] = useState("");
  const [title, setTitle] = useState("New session");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<"models" | "voices" | "attachments" | "sessions" | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [voice, setVoice] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [ampAvailable, setAmpAvailable] = useState(false);
  const [modelLabel, setModelLabel] = useState<string | null>(null);

  // ── refs ────────────────────────────────────────────────────────────────
  const phaseRef = useRef(phase);
  const sessionIdRef = useRef<string | null>(null);
  const cwdRef = useRef<string>("");
  const manualModelRef = useRef<{ provider: string; modelId: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const middleRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sessionsBodyRef = useRef<HTMLDivElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const micAnalyserRef = useRef<{ analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);
  const elapsedMsRef = useRef(0);
  const silenceMsRef = useRef(0);
  const sendingRef = useRef(false);
  const runActiveRef = useRef(false);
  const runTextRef = useRef("");

  const audioGraphRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);
  const audioUnlockedRef = useRef(false);
  const playbackRef = useRef<{ gen: number; stopped: boolean; waiter: (() => void) | null }>({
    gen: 0,
    stopped: false,
    waiter: null,
  });
  const prefetchRef = useRef(new Map<string, Promise<string>>());

  const gestureRef = useRef({
    down: false,
    downX: 0,
    downY: 0,
    longTimer: 0 as ReturnType<typeof setTimeout> | 0,
    tapTimer: 0 as ReturnType<typeof setTimeout> | 0,
    longFired: false,
    lastTapAt: 0,
  });

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const labelFor = useCallback(
    (provider: string, modelId: string): string => {
      const m = models.find((x) => x.provider === provider && x.id === modelId);
      return m?.name || `${provider}/${modelId}`;
    },
    [models],
  );

  // ── audio graph (amplitude-synced glow + iOS audio unlock) ──────────────
  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Unlock playback: browsers with autoplay blocking (Brave, Safari) refuse
    // programmatic play() unless the element has already played from inside a
    // user gesture. A one-shot silent play here establishes that.
    if (!audioUnlockedRef.current) {
      audioUnlockedRef.current = true;
      try {
        audio.muted = true;
        audio.src = SILENT_WAV;
        audio
          .play()
          .then(() => {
            audio.pause();
            audio.muted = false;
            audio.removeAttribute("src");
          })
          .catch((e) => {
            console.warn("[chat-tts] silent unlock play failed:", e);
            audio.muted = false;
            audio.removeAttribute("src");
          });
      } catch (e) {
        console.warn("[chat-tts] silent unlock failed:", e);
        audio.muted = false;
      }
    }

    if (audioGraphRef.current) {
      void audioGraphRef.current.ctx.resume().catch(() => {});
      return;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      void ctx.resume().catch(() => {});
      // Only route the element through Web Audio while the context is actually
      // running: createMediaElementSource PERMANENTLY redirects the element's
      // output through the graph, so a suspended context would mean silent
      // playback forever. No graph = native playback + steady CSS pulse.
      if (ctx.state !== "running") {
        console.warn(`[chat-tts] AudioContext not running (${ctx.state}); amplitude sync disabled, native playback`);
        return;
      }
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioGraphRef.current = { ctx, analyser, data: new Uint8Array(analyser.fftSize) };
      setAmpAvailable(true);
      console.log(`[chat-tts] audio graph active (state=${ctx.state})`);
    } catch (e) {
      // No Web Audio → the glow falls back to a steady CSS pulse.
      console.warn("[chat-tts] audio graph unavailable:", e);
    }
  }, []);

  // ── TTS busy claim/release (defers the queued 250k compaction) ─────────
  const claimTtsBusy = useCallback((busy: boolean) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    void fetch("/api/chat/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: sid, busy }),
    }).catch(() => {});
  }, []);

  // ── playback ───────────────────────────────────────────────────────────
  const chunkUrl = useCallback((sid: string, index: number): Promise<string> => {
    const key = `${sid}:${index}`;
    const map = prefetchRef.current;
    let p = map.get(key);
    if (!p) {
      p = fetch(`/api/chat/tts?session=${encodeURIComponent(sid)}&chunk=${index}`)
        .then((r) => {
          if (!r.ok) throw new Error(`TTS chunk failed (${r.status})`);
          return r.blob();
        })
        .then((b) => URL.createObjectURL(b));
      map.set(key, p);
    }
    return p;
  }, []);

  const waitForEnded = useCallback((gen: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      const audio = audioRef.current;
      if (!audio) return resolve();
      const done = () => {
        audio.removeEventListener("ended", done);
        if (playbackRef.current.waiter === done) playbackRef.current.waiter = null;
        resolve();
      };
      playbackRef.current.waiter = done;
      audio.addEventListener("ended", done);
      if (playbackRef.current.stopped || gen !== playbackRef.current.gen) done();
    });
  }, []);

  const releaseTts = useCallback(() => {
    claimTtsBusy(false);
    setPhase("idle");
  }, [claimTtsBusy]);

  const stopPlayback = useCallback(() => {
    playbackRef.current.stopped = true;
    playbackRef.current.gen += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    playbackRef.current.waiter?.();
    claimTtsBusy(false);
    setPhase("idle");
  }, [claimTtsBusy]);

  const playChunks = useCallback(
    async (sid: string, chunkCount: number, from: number) => {
      const gen = ++playbackRef.current.gen;
      playbackRef.current.stopped = false;
      const audio = audioRef.current;
      if (!audio) return;
      let started = false;
      for (let i = from; i < chunkCount; i += 1) {
        if (playbackRef.current.stopped || gen !== playbackRef.current.gen) break;
        let url: string;
        try {
          url = await chunkUrl(sid, i);
        } catch (e) {
          console.error("[chat-tts] chunk fetch failed:", e);
          setError(
            `Text-to-speech failed (${e instanceof Error ? e.message : "chunk error"}) — press-and-hold to retry.`,
          );
          break;
        }
        if (playbackRef.current.stopped || gen !== playbackRef.current.gen) break;
        audio.src = url;
        // If the graph exists, its context must be running or the element is
        // silently muted — resume() is a no-op when already running.
        if (audioGraphRef.current) {
          try {
            await audioGraphRef.current.ctx.resume();
          } catch {
            /* keep going; play() below reports the real failure */
          }
        }
        try {
          await audio.play();
          console.log(`[chat-tts] playing chunk ${i}/${chunkCount} (graph=${audioGraphRef.current ? "on" : "off"})`);
        } catch (e) {
          const name = e instanceof Error ? e.name : "Error";
          console.error("[chat-tts] play() failed:", e);
          setError(
            name === "NotAllowedError"
              ? "The browser blocked audio playback — tap the page once, then press-and-hold to replay."
              : `Audio playback failed (${name}). Press-and-hold to replay.`,
          );
          break;
        }
        if (!started) {
          started = true;
          setPhase("tts_playing");
        }
        void chunkUrl(sid, i + 1).catch(() => {});
        await waitForEnded(gen);
      }
      if (gen === playbackRef.current.gen) releaseTts();
    },
    [chunkUrl, waitForEnded, releaseTts],
  );

  const startTts = useCallback(
    async (fromChunk = 0) => {
      const sid = sessionIdRef.current;
      if (!sid) {
        setPhase("idle");
        return;
      }
      setPhase("tts_connecting");
      claimTtsBusy(true);
      try {
        const res = await fetch(`/api/chat/tts?session=${encodeURIComponent(sid)}`);
        if (!res.ok) {
          console.warn("[chat-tts] manifest not available:", res.status);
          releaseTts();
          return;
        }
        const { chunkCount } = (await res.json()) as { chunkCount: number };
        await playChunks(sid, chunkCount, fromChunk);
      } catch (e) {
        console.error("[chat-tts] startTts failed:", e);
        setError("Text-to-speech failed — press-and-hold to retry.");
        releaseTts();
      }
    },
    [claimTtsBusy, playChunks, releaseTts],
  );

  // ── run completion → display + TTS ─────────────────────────────────────
  const runEnded = useCallback(() => {
    if (!runActiveRef.current) return;
    runActiveRef.current = false;
    const finish = (text: string) => {
      if (text) setResponseText(text);
      setActivity("");
      void startTts(0);
    };
    if (runTextRef.current) {
      finish(runTextRef.current);
      return;
    }
    // No text came through the stream — read it back from the session.
    const sid = sessionIdRef.current;
    if (!sid) {
      setPhase("idle");
      return;
    }
    void fetch(`/api/chat/session/${encodeURIComponent(sid)}/load`, { method: "POST" })
      .then((r) => r.json())
      .then((d: { text?: string }) => finish(d.text ?? ""))
      .catch((e) => {
        console.error("[chat-tts] post-run load failed:", e);
        releaseTts();
      });
  }, [startTts, releaseTts]);

  // ── SSE ────────────────────────────────────────────────────────────────
  const handleAgentEvent = useCallback(
    (event: Record<string, unknown>) => {
      switch (event.type) {
        case "agent_start":
          runActiveRef.current = true;
          setPhase("working");
          setActivity("Working");
          break;
        case "message_update": {
          const inner = event.assistantMessageEvent as { type?: string } | undefined;
          const innerType = inner?.type;
          if (innerType === "thinking_delta") setActivity("Thinking");
          else if (innerType === "text_delta") setActivity("Working");
          break;
        }
        case "message_end": {
          const msg = event.message as
            | { role?: string; content?: Array<{ type: string; text?: string }> }
            | undefined;
          if (msg?.role === "assistant" && msg.content) {
            const text = msg.content
              .filter((b) => b.type === "text" && b.text)
              .map((b) => b.text)
              .join("\n\n")
              .trim();
            if (text) {
              runTextRef.current = text;
              setResponseText(text);
            }
          }
          break;
        }
        case "tool_execution_start": {
          const name = (event.toolName as string) || "tool";
          setActivity((prev) => (prev && prev !== "Working" && prev !== "Thinking" ? `${prev}, ${name}` : name));
          break;
        }
        case "tool_execution_end": {
          const name = (event.toolName as string) || "";
          setActivity((prev) =>
            prev
              .split(", ")
              .filter((n) => n !== name)
              .join(", "),
          );
          break;
        }
        case "agent_end":
          runEnded();
          break;
        case "prompt_error":
          runActiveRef.current = false;
          setPhase("idle");
          setError((event.errorMessage as string) || "Something went wrong");
          break;
        case "session_info_changed": {
          const name = event.name as string | undefined;
          if (name) setTitle(name);
          break;
        }
      }
    },
    [runEnded],
  );

  const connectSSE = useCallback(
    (sid: string) => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      const es = new EventSource(`/api/agent/${encodeURIComponent(sid)}/events`);
      es.onmessage = (e) => {
        try {
          handleAgentEvent(JSON.parse(e.data) as Record<string, unknown>);
        } catch {
          /* ignore malformed frames */
        }
      };
      esRef.current = es;
    },
    [handleAgentEvent],
  );

  // Reconciliation: catches agent_start/agent_end missed while the SSE was
  // not yet connected (or a backgrounded tab missed the event).
  const reconcile = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`);
      const data = (await res.json()) as {
        state?: { isStreaming?: boolean; isPromptRunning?: boolean; isCompacting?: boolean } | null;
      };
      const st = data.state;
      if (!st) return;
      if (st.isStreaming || st.isPromptRunning) {
        if (phaseRef.current === "connecting") setPhase("working");
      } else if (!st.isCompacting && (phaseRef.current === "connecting" || phaseRef.current === "working")) {
        runEnded();
      }
    } catch {
      /* transient */
    }
  }, [runEnded]);

  useEffect(() => {
    if (phase !== "connecting" && phase !== "working") return;
    const iv = setInterval(() => void reconcile(), 12_000);
    return () => clearInterval(iv);
  }, [phase, reconcile]);

  // ── prompt send ────────────────────────────────────────────────────────
  const buildPromptParts = useCallback(async (): Promise<{
    message: string;
    images: Array<{ type: "image"; data: string; mimeType: string }>;
  }> => {
    const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
    const paths: string[] = [];
    for (const item of staged) {
      if (item.isImage) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read file"));
          reader.readAsDataURL(item.file);
        });
        images.push({
          type: "image",
          data: dataUrl.split(",")[1] ?? "",
          mimeType: item.file.type || "image/png",
        });
      } else {
        const fd = new FormData();
        fd.append("file", item.file, item.file.name);
        const res = await fetch("/api/attachments", { method: "POST", body: fd });
        const data = (await res.json()) as { path?: string; error?: string };
        if (!res.ok || !data.path) throw new Error(data.error || "Attachment upload failed");
        paths.push(`@${data.path}`);
      }
    }
    return { message: paths.join("\n"), images };
  }, [staged]);

  const sendPrompt = useCallback(
    async (text: string) => {
      stopPlayback();
      setError(null);
      setPhase("connecting");
      runTextRef.current = "";
      prefetchRef.current.clear();

      const parts = await buildPromptParts();
      const message = [parts.message, text].filter(Boolean).join("\n");
      let sid = sessionIdRef.current;
      if (sid) {
        const res = await fetch(`/api/chat/session/${encodeURIComponent(sid)}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, images: parts.images }),
        });
        const data = (await res.json()) as { error?: string; model?: { provider: string; modelId: string } };
        if (!res.ok) throw new Error(data.error || "Send failed");
        if (data.model) setModelLabel(labelFor(data.model.provider, data.model.modelId));
      } else {
        const res = await fetch("/api/chat/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, images: parts.images, model: manualModelRef.current ?? undefined }),
        });
        const data = (await res.json()) as {
          sessionId?: string;
          model?: { provider: string; modelId: string };
          error?: string;
        };
        if (!res.ok || !data.sessionId) throw new Error(data.error || "Send failed");
        sid = data.sessionId;
        setSessionId(sid);
        if (data.model) setModelLabel(labelFor(data.model.provider, data.model.modelId));
      }
      setStaged([]);
      runActiveRef.current = true;
      connectSSE(sid);
      // Catch an agent_start that fired before the SSE connected.
      setTimeout(() => void reconcile(), 2_500);
    },
    [buildPromptParts, connectSSE, labelFor, reconcile, stopPlayback],
  );

  // ── recording ──────────────────────────────────────────────────────────
  const cleanupRecorder = useCallback(() => {
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    recorderRef.current = null;
    micAnalyserRef.current = null;
    elapsedMsRef.current = 0;
    silenceMsRef.current = 0;
  }, []);

  const stopRecorder = useCallback((): Promise<Blob> => {
    return new Promise<Blob>((resolve) => {
      const rec = recorderRef.current;
      const chunks = recChunksRef.current;
      if (!rec || rec.state === "inactive") {
        cleanupRecorder();
        resolve(new Blob(chunks));
        return;
      }
      rec.onstop = () => {
        cleanupRecorder();
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });
  }, [cleanupRecorder]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      rec.start();
      recorderRef.current = rec;
      recStreamRef.current = stream;
      elapsedMsRef.current = 0;
      silenceMsRef.current = 0;

      // Silence watch on the mic stream (reuses the shared AudioContext).
      try {
        const ctx = audioGraphRef.current?.ctx ?? new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        micAnalyserRef.current = { analyser, data: new Uint8Array(analyser.fftSize) };
      } catch {
        micAnalyserRef.current = null;
      }
      setPhase("recording");
    } catch {
      setError("Microphone unavailable");
      setPhase("idle");
    }
  }, []);

  const cancelRecording = useCallback(() => {
    const rec = recorderRef.current;
    recChunksRef.current = [];
    if (rec && rec.state !== "inactive") {
      rec.onstop = () => cleanupRecorder();
      rec.stop();
    } else {
      cleanupRecorder();
    }
    setPhase("idle");
  }, [cleanupRecorder]);

  const stopAndSend = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      const blob = await stopRecorder();
      if (blob.size === 0) {
        setPhase("idle");
        return;
      }
      setPhase("connecting");
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || "No speech recognized");
      await sendPrompt(data.text);
    } catch (e) {
      setPhase("idle");
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      sendingRef.current = false;
    }
  }, [stopRecorder, sendPrompt]);

  // Silence auto-stop + 5-minute hard cap while recording.
  useEffect(() => {
    if (phase !== "recording" && phase !== "recording_paused") return;
    const iv = setInterval(() => {
      if (phaseRef.current !== "recording") return;
      elapsedMsRef.current += 300;
      const mic = micAnalyserRef.current;
      if (mic) {
        mic.analyser.getByteTimeDomainData(mic.data);
        let sum = 0;
        for (let i = 0; i < mic.data.length; i += 1) {
          const v = (mic.data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / mic.data.length);
        silenceMsRef.current = rms < SILENCE_RMS ? silenceMsRef.current + 300 : 0;
      }
      if (elapsedMsRef.current >= MAX_RECORD_MS || silenceMsRef.current >= MAX_SILENCE_MS) {
        void stopAndSend();
      }
    }, 300);
    return () => clearInterval(iv);
  }, [phase, stopAndSend]);

  // ── amplitude-driven glow while TTS plays ──────────────────────────────
  useEffect(() => {
    if (phase !== "tts_playing" || !ampAvailable) return;
    let raf = 0;
    const tick = () => {
      const graph = audioGraphRef.current;
      const glow = glowRef.current;
      if (graph && glow) {
        graph.analyser.getByteTimeDomainData(graph.data);
        let sum = 0;
        for (let i = 0; i < graph.data.length; i += 1) {
          const v = (graph.data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / graph.data.length);
        // Smooth, speech-shaped: silence floors at 0.15, loud peaks near 1.
        const amp = Math.min(1, Math.max(0.15, rms * 6));
        glow.style.setProperty("--glow-amp", amp.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, ampAvailable]);

  // ── gestures ───────────────────────────────────────────────────────────
  const isUiTarget = useCallback((target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return false;
    return el.closest("[data-ui]") !== null;
  }, []);

  const isScrollableMiddle = useCallback((target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    const middle = middleRef.current;
    if (!el || !middle || typeof el.closest !== "function") return false;
    return el.closest(".chat-middle") !== null && middle.scrollHeight > middle.clientHeight + 4;
  }, []);

  const onSingleTap = useCallback(() => {
    const p = phaseRef.current;
    if (p === "recording") {
      recorderRef.current?.pause();
      setPhase("recording_paused");
    } else if (p === "recording_paused") {
      recorderRef.current?.resume();
      setPhase("recording");
    } else if (p === "tts_playing") {
      audioRef.current?.pause();
      setPhase("tts_paused");
    } else if (p === "tts_paused") {
      void audioRef.current?.play().catch(() => {});
      setPhase("tts_playing");
    }
  }, []);

  const onDoubleTap = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle") {
      ensureAudioGraph();
      void startRecording();
    } else if (p === "recording" || p === "recording_paused") {
      void stopAndSend();
    }
  }, [ensureAudioGraph, startRecording, stopAndSend]);

  const onLongPress = useCallback(() => {
    const p = phaseRef.current;
    if (p === "recording" || p === "recording_paused") {
      cancelRecording();
    } else if (p === "tts_playing" || p === "tts_paused") {
      stopPlayback();
    } else if (p === "idle" && sessionIdRef.current) {
      // "long press again replays the previous TTS message"
      ensureAudioGraph();
      void startTts(0);
    }
  }, [cancelRecording, stopPlayback, ensureAudioGraph, startTts]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (isUiTarget(e.target) || isScrollableMiddle(e.target)) return;
      ensureAudioGraph();
      const g = gestureRef.current;
      g.down = true;
      g.longFired = false;
      g.downX = e.clientX;
      g.downY = e.clientY;
      if (g.longTimer) clearTimeout(g.longTimer);
      g.longTimer = setTimeout(() => {
        g.longFired = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [ensureAudioGraph, isUiTarget, isScrollableMiddle, onLongPress],
  );

  const handlePointerMove = useCallback((e: ReactPointerEvent) => {
    const g = gestureRef.current;
    if (!g.down || g.longFired) return;
    if (Math.abs(e.clientX - g.downX) > 12 || Math.abs(e.clientY - g.downY) > 12) {
      clearTimeout(g.longTimer);
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    const g = gestureRef.current;
    if (!g.down) return;
    g.down = false;
    if (g.longTimer) clearTimeout(g.longTimer);
    if (g.longFired) {
      g.longFired = false;
      return;
    }
    const now = Date.now();
    if (now - g.lastTapAt < DOUBLE_TAP_MS) {
      if (g.tapTimer) clearTimeout(g.tapTimer);
      g.lastTapAt = 0;
      onDoubleTap();
    } else {
      g.lastTapAt = now;
      g.tapTimer = setTimeout(() => {
        g.lastTapAt = 0;
        onSingleTap();
      }, DOUBLE_TAP_MS);
    }
  }, [onDoubleTap, onSingleTap]);

  const handlePointerCancel = useCallback(() => {
    const g = gestureRef.current;
    g.down = false;
    if (g.longTimer) clearTimeout(g.longTimer);
    if (g.tapTimer) clearTimeout(g.tapTimer);
  }, []);

  // ── popups ─────────────────────────────────────────────────────────────
  const refreshModels = useCallback(async () => {
    const cachedModels = readCacheValue<ModelRow[]>("models");
    if (cachedModels) setModels(cachedModels);
    if (!cwdRef.current) {
      const r = await fetch("/api/default-cwd", { method: "POST" }).catch(() => null);
      const d = (await r?.json()) as { cwd?: string } | undefined;
      cwdRef.current = d?.cwd ?? "";
    }
    if (cwdRef.current) {
      const r = await fetch(`/api/models?cwd=${encodeURIComponent(cwdRef.current)}`).catch(() => null);
      const d = (await r?.json()) as { modelList?: ModelRow[] } | undefined;
      if (d?.modelList) {
        setModels(d.modelList);
        writeCache("models", d.modelList);
      }
    }
  }, []);

  // Warm the model list at load — it feeds the "<model> - <title>" label.
  useEffect(() => {
    void refreshModels();
    const cachedVoices = readCacheValue<{ voices: string[]; current: string }>("voices");
    if (cachedVoices) {
      setVoices(cachedVoices.voices);
      setVoice(cachedVoices.current);
    }
    void fetch("/api/chat/voices")
      .then((r) => r.json())
      .then((d: { voices?: string[]; current?: string }) => {
        if (d.voices) setVoices(d.voices);
        if (d.current) setVoice(d.current);
        if (d.voices && d.current) writeCache("voices", { voices: d.voices, current: d.current });
      })
      .catch(() => {});
  }, [refreshModels]);

  const openPopup = useCallback(async (which: "models" | "voices" | "attachments" | "sessions") => {
    setPopup(which);
    if (which === "models") {
      await refreshModels();
    } else if (which === "voices") {
      const r = await fetch("/api/chat/voices").catch(() => null);
      const d = (await r?.json()) as { voices?: string[]; current?: string } | undefined;
      if (d?.voices) setVoices(d.voices);
      if (d?.current) setVoice(d.current);
    } else if (which === "sessions") {
      const cachedSessions = readCacheValue<SessionRow[]>("sessions");
      if (cachedSessions) setSessions(cachedSessions);
      const r = await fetch("/api/chat/sessions").catch(() => null);
      const d = (await r?.json()) as { sessions?: SessionRow[] } | undefined;
      if (d?.sessions) {
        setSessions(d.sessions);
        writeCache("sessions", d.sessions);
      }
    }
  }, [refreshModels]);

  // Sessions popup: scrolled to the bottom (most recent) on open.
  useEffect(() => {
    if (popup === "sessions" && sessionsBodyRef.current) {
      sessionsBodyRef.current.scrollTop = sessionsBodyRef.current.scrollHeight;
    }
  }, [popup, sessions]);

  const selectModel = useCallback(async (m: ModelRow) => {
    const sid = sessionIdRef.current;
    if (sid) {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "set_model", provider: m.provider, modelId: m.id }),
      }).catch(() => {});
    } else {
      manualModelRef.current = { provider: m.provider, modelId: m.id };
    }
    setModelLabel(m.name || `${m.provider}/${m.id}`);
    setPopup(null);
  }, []);

  const pickVoice = useCallback(async (v: string) => {
    const res = await fetch("/api/chat/voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: v }),
    }).catch(() => null);
    if (res?.ok) setVoice(v);
    setPopup(null);
  }, []);

  const openSession = useCallback(
    async (s: SessionRow) => {
      stopPlayback();
      setPopup(null);
      setError(null);
      setSessionId(s.id);
      const cachedConvo = readCacheValue<{ name: string; text: string }>(`convo:${s.id}`);
      if (cachedConvo) {
        setTitle(cachedConvo.name);
        setResponseText(cachedConvo.text);
      } else {
        setTitle(s.name);
        setResponseText("");
      }
      setActivity("");
      setPhase("connecting");
      try {
        const res = await fetch(`/api/chat/session/${encodeURIComponent(s.id)}/load`, { method: "POST" });
        const data = (await res.json()) as {
          name?: string;
          text?: string;
          model?: { provider: string; modelId: string };
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Load failed");
        setTitle(data.name || s.name);
        setResponseText(data.text ?? "");
        writeCache(`convo:${s.id}`, {
          name: data.name || s.name,
          text: (data.text ?? "").slice(0, CONVO_TEXT_CAP),
        });
        if (data.model) setModelLabel(labelFor(data.model.provider, data.model.modelId));
        setPhase("idle");
        connectSSE(s.id);
      } catch (e) {
        setPhase("idle");
        setError(String(e instanceof Error ? e.message : e));
      }
    },
    [connectSSE, labelFor, stopPlayback],
  );

  const startNewSession = useCallback(() => {
    stopPlayback();
    esRef.current?.close();
    esRef.current = null;
    manualModelRef.current = null;
    runActiveRef.current = false;
    setSessionId(null);
    setTitle("New session");
    setModelLabel(null);
    setResponseText("");
    setActivity("");
    setError(null);
    setPhase("idle");
  }, [stopPlayback]);

  // ── attachments staging ────────────────────────────────────────────────
  const stageFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: StagedFile[] = [];
    for (const file of Array.from(files)) {
      next.push({
        file,
        isImage: file.type.startsWith("image/") || (!file.type && IMAGE_EXT.test(file.name)),
      });
    }
    setStaged((prev) => [...prev, ...next]);
    setPopup(null);
  }, []);

  // ── cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      esRef.current?.close();
      recStreamRef.current?.getTracks().forEach((t) => t.stop());
      const g = gestureRef.current;
      if (g.longTimer) clearTimeout(g.longTimer);
      if (g.tapTimer) clearTimeout(g.tapTimer);
    };
  }, []);

  // ── render ─────────────────────────────────────────────────────────────
  const glow = glowFor(phase, ampAvailable);
  const showActivity = phase === "working";
  const fullTitle = modelLabel ? `${modelLabel} - ${title}` : title;

  return (
    <div
      className="chat-root"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="chat-top">
        <div className="chat-title" title={fullTitle}>
          {fullTitle}
        </div>
      </div>

      <div className="chat-middle" ref={middleRef}>
        {showActivity ? (
          <div className="chat-activity">{activity || "Working"}</div>
        ) : responseText ? (
          <div className="chat-response">
            <MarkdownBody>{responseText}</MarkdownBody>
          </div>
        ) : null}
        {error ? <div className="chat-error">{error}</div> : null}
      </div>

      <div className="chat-bottom">
        <div className="chat-bottom-inner">
          {staged.length > 0 && (
            <div className="pending-chips">
              {staged.map((s, i) => (
                <span key={`${s.file.name}-${i}`} className="pending-chip">
                  {s.file.name}
                </span>
              ))}
            </div>
          )}
          <div className="bottom-bar">
            <button
              className="bar-btn"
              data-ui
              aria-label="Models"
              title="Models"
              onClick={() => void openPopup("models")}
            >
              <span className="bar-icon" style={{ "--icon": `url("${modelsIcon}")` } as CSSProperties} />
            </button>
            <button
              className="bar-btn"
              data-ui
              aria-label="Voice"
              title="Voice"
              onClick={() => void openPopup("voices")}
            >
              <span className="bar-icon" style={{ "--icon": `url("${voiceIcon}")` } as CSSProperties} />
            </button>
            <button
              className="bar-btn"
              data-ui
              aria-label="Attachments"
              title="Attachments"
              onClick={() => void openPopup("attachments")}
            >
              <span className="bar-icon" style={{ "--icon": `url("${attachmentsIcon}")` } as CSSProperties} />
            </button>
            <button
              className="bar-btn"
              data-ui
              aria-label="New session"
              title="New session"
              onClick={startNewSession}
            >
              <span className="bar-icon" style={{ "--icon": `url("${newSessionIcon}")` } as CSSProperties} />
            </button>
            <button
              className="bar-btn"
              data-ui
              aria-label="Sessions"
              title="Sessions"
              onClick={() => void openPopup("sessions")}
            >
              <span className="bar-icon" style={{ "--icon": `url("${sessionsIcon}")` } as CSSProperties} />
            </button>
          </div>
        </div>
      </div>

      <div
        className={`glow-overlay glow--${glow.mode}`}
        ref={glowRef}
        style={{ "--glow-color": glow.mode === "off" ? "transparent" : GLOW_COLORS[glow.color] } as CSSProperties}
      >
        <div className="glow-edge">
          <div className="glow-layer glow-layer--wide" />
          <div className="glow-layer glow-layer--core" />
        </div>
        <div className="glow-arc" />
      </div>

      <audio ref={audioRef} style={{ display: "none" }} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,text/*,.pdf,.md,.json,.csv,.log,.yaml,.yml,.toml"
        style={{ display: "none" }}
        data-ui
        onChange={(e) => stageFiles(e.target.files)}
      />

      {popup === "models" && (
        <Popup title="Models" onClose={() => setPopup(null)}>
          {models.length === 0 ? (
            <div className="popup-empty">No models available</div>
          ) : (
            models.map((m) => (
              <button key={`${m.provider}/${m.id}`} className="popup-row" data-ui onClick={() => void selectModel(m)}>
                {m.name || m.id} · {m.provider}
              </button>
            ))
          )}
        </Popup>
      )}

      {popup === "voices" && (
        <Popup title="Voice" onClose={() => setPopup(null)}>
          {voices.length === 0 ? (
            <div className="popup-empty">No voices available</div>
          ) : (
            voices.map((v) => (
              <button key={v} className="popup-row" data-ui aria-selected={v === voice} onClick={() => void pickVoice(v)}>
                {v}
              </button>
            ))
          )}
        </Popup>
      )}

      {popup === "attachments" && (
        <Popup title="Attachments" onClose={() => setPopup(null)}>
          {staged.length === 0 ? (
            <div className="popup-empty">Nothing staged — files are sent with your next voice prompt.</div>
          ) : (
            staged.map((s, i) => (
              <button
                key={`${s.file.name}-${i}`}
                className="popup-row"
                data-ui
                onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
              >
                {s.file.name} ✕
              </button>
            ))
          )}
          <div className="popup-actions">
            <button className="popup-action" data-ui onClick={() => fileInputRef.current?.click()}>
              Add files
            </button>
          </div>
        </Popup>
      )}

      {popup === "sessions" && (
        <Popup title="Sessions" onClose={() => setPopup(null)} bodyRef={sessionsBodyRef}>
          {sessions.length === 0 ? (
            <div className="popup-empty">No past sessions yet</div>
          ) : (
            sessions.map((s) => (
              <button key={s.id} className="popup-row" data-ui onClick={() => void openSession(s)}>
                {s.name}
              </button>
            ))
          )}
        </Popup>
      )}
    </div>
  );
}
