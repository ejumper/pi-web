"use client";

import { useSyncExternalStore } from "react";
import type { ThinkingLevel } from "@/components/SessionControls";

/**
 * Bridge between the prompt editor's prop tree and the sidebar's Controls
 * section. ChatInput already receives all session-level controls (guard,
 * read mode, reasoning, tools, compaction, sound) from ChatWindow,
 * but the sidebar lives in a different subtree under AppShell — instead of
 * lifting that state through unrelated layers, ChatInput publishes it here
 * and SessionControls subscribes.
 *
 * Loop-safety (learned the hard way): the useSyncExternalStore snapshot is
 * a version NUMBER, never a fresh object, and publishing an unchanged
 * value-set is a no-op that does not notify. ChatInput's publish effect and
 * the subscribers' re-renders can therefore never feed each other into a
 * "maximum update depth" spiral — a repeat publish with equal values just
 * stops. Handler closures are always adopted (so the latest ones are used)
 * without bumping the version.
 */
export interface SessionControlsState {
  isStreaming?: boolean;
  liveRemoteState?: { name?: string; guardEnabled?: boolean; readMode?: "read" | "work"; thinkingLevel?: string } | null;
  onGuardChange?: (enabled: boolean) => void;
  onReadModeChange?: (mode: "read" | "work") => void;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

/** Value fields whose changes actually need a subscriber re-render. */
const VALUE_KEYS = [
  "isStreaming",
  "liveRemoteState",
  "thinkingLevel",
  "availableThinkingLevels",
  "thinkingLevelMap",
  "toolPreset",
  "isCompacting",
  "compactError",
  "soundEnabled",
] as const;

/**
 * Structural compare for the value fields — one level deep, which covers
 * liveRemoteState (primitives), the arrays, and thinkingLevelMap. Identity
 * churn in upstream props must never read as "changed", or a re-render
 * cascade could notify forever.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length
      && ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

// The object is mutated in place and stays referentially stable forever;
// `version` is what subscribers compare snapshots against.
const current: SessionControlsState = {};
let version = 0;
const listeners = new Set<() => void>();

export function publishSessionControls(state: SessionControlsState) {
  let changed = false;
  for (const key of VALUE_KEYS) {
    if (!sameValue(current[key], state[key])) {
      changed = true;
      break;
    }
  }
  // Always adopt the fresh handlers (latest closures), re-render or not.
  Object.assign(current, state);
  if (!changed) return;
  version += 1;
  listeners.forEach((l) => l());
}

export function useSessionControls(): SessionControlsState {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => version,
    () => 0,
  );
  return current;
}
