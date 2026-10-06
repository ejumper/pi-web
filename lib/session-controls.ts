"use client";

import { useSyncExternalStore } from "react";
import type { ThinkingLevel } from "@/components/SessionControls";

/**
 * Bridge between the prompt editor's prop tree and the sidebar's Controls
 * section. ChatInput already receives all session-level controls (guard,
 * read mode, reasoning, tools, open-file inclusion, sound) from ChatWindow,
 * but the sidebar lives in a different subtree under AppShell — instead of
 * lifting that state through unrelated layers, ChatInput publishes it here
 * and SessionControls subscribes.
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
  hasOpenFile?: boolean;
  fileIncluded?: boolean;
  onToggleFileIncluded?: () => void;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

let current: SessionControlsState | null = null;
const listeners = new Set<() => void>();

export function publishSessionControls(state: SessionControlsState) {
  current = state;
  listeners.forEach((l) => l());
}

export function useSessionControls(): SessionControlsState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}
