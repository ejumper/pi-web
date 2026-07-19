"use client";

import { useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import type { ChatInputHandle } from "@/components/ChatInput";

// ---------------------------------------------------------------------------
// Module-level registry — ChatWindow registers the abort handler here so that
// the global Esc listener in AppShell can call it without prop-drilling.
// ---------------------------------------------------------------------------
let globalAbortHandler: (() => void) | null = null;

/**
 * Register (or clear) the abort handler for the global Esc shortcut.
 * Call this from ChatWindow whenever agentRunning or handleAbort changes.
 */
export function registerAbortHandler(handler: (() => void) | null): void {
  globalAbortHandler = handler;
}

// ---------------------------------------------------------------------------
// Hook: global keyboard shortcuts
// ---------------------------------------------------------------------------

interface UseGlobalKeyboardShortcutsOptions {
  /** Called when Ctrl+Alt+N is pressed. Receives current cwd. */
  onNewSession?: (cwd: string) => void;
  /** The currently selected project directory (sidebar cwd). */
  activeCwd?: string | null;
  /** For Ctrl/Cmd+I focus-cycling between the chat prompt and the open file editor. */
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  /** Returns the currently active tab's live CM6 view, or null/undefined if none (editor closed or in Preview). */
  getActiveEditorView?: () => EditorView | null | undefined;
}

/**
 * Register global keyboard shortcuts for the application.
 *
 * Shortcuts handled here:
 *   Esc          – stop the running agent (via module-level abort handler)
 *   Ctrl+Alt+N   – create a new session in the active project directory
 *   Ctrl/Cmd+I   – cycle focus between the chat prompt and the open file
 *                  editor (if open and in Raw/source view — the CM6 view
 *                  only exists in that state, so its mere presence is the
 *                  check). Focus elsewhere always goes to the prompt.
 *
 * Note: Esc inside <textarea> or <input> is deliberately NOT handled here.
 * ChatInput manages its own Esc logic (closing slash / @ file menus, stopping
 * the agent when no menu is open) because it needs intimate knowledge of menu
 * state that is local to that component.
 *
 * Ctrl/Cmd+I is registered as a separate, capture-phase listener (below)
 * rather than folded into the bubble-phase handler above: it needs to read
 * document.activeElement and decide+act *before* the keydown ever reaches
 * CodeMirror's own contentDOM. A bubble-phase listener would run after CM6's
 * internal keymap already moved focus (if CM6 handled it first), so checking
 * activeElement at that point reflects the *new* focus, not the original —
 * that mismatch caused a same-tick double-toggle bouncing focus right back.
 * Capturing first and calling stopPropagation() means CM6 never sees the key
 * at all when this hook decides to handle it, so there's no CM6-side keymap
 * override needed for Mod-i either.
 */
export function useGlobalKeyboardShortcuts(
  options: UseGlobalKeyboardShortcutsOptions,
): void {
  const { onNewSession, activeCwd, chatInputRef, getActiveEditorView } = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // ---- Esc: stop agent ----
      if (e.key === "Escape") {
        if (!globalAbortHandler) return;

        const tag = (e.target as HTMLElement)?.tagName;
        // Let textarea/input handle Esc internally (ChatInput menus / stop).
        if (tag === "TEXTAREA" || tag === "INPUT") return;

        e.preventDefault();
        globalAbortHandler();
        return;
      }

      // ---- Ctrl+Alt+N: new session ----
      if (e.key === "n" && e.ctrlKey && e.altKey) {
        if (!activeCwd || !onNewSession) return;
        e.preventDefault();
        onNewSession(activeCwd);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeCwd, onNewSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== "i" || (!e.ctrlKey && !e.metaKey) || e.shiftKey || e.altKey) return;

      // Capture where focus was BEFORE anything reacts to this keypress.
      const active = document.activeElement;
      const editorView = getActiveEditorView?.();
      const wasInEditor = !!editorView && editorView.dom.contains(active);
      const chatEl = chatInputRef?.current?.getTextareaEl();
      const wasInChat = active === chatEl;

      e.preventDefault();
      e.stopPropagation(); // keep this keypress from ever reaching CM6's own keymap

      if (wasInEditor) {
        chatInputRef?.current?.focus();
      } else if (wasInChat) {
        editorView?.focus(); // no-op if editor isn't open/isn't in Raw view — stays in the prompt
      } else {
        chatInputRef?.current?.focus();
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [chatInputRef, getActiveEditorView]);
}
