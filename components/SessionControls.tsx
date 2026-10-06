"use client";

import { useEffect, useRef, useState } from "react";
import { useSessionControls } from "@/lib/session-controls";

export type ThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "Use pi default",
  off: "Reasoning off",
  minimal: "Minimal reasoning",
  low: "Low reasoning",
  medium: "Medium reasoning",
  high: "High reasoning",
  xhigh: "Extra-high reasoning",
  max: "Max reasoning",
};

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = { off: "none", default: "default", full: "full" };

interface Props {
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

/**
 * Session-level controls, moved out of the prompt editor's overflow menu so
 * they're always visible in the sidebar (and never behind "More" on mobile):
 * terminal guard, read/write mode, reasoning level, tool preset, open-file
 * inclusion, and the completion sound. Dropdowns open upward like they did
 * in the prompt row — the panel sits at the bottom of the sidebar.
 */
export function SessionControls({
  isStreaming,
  liveRemoteState,
  onGuardChange,
  onReadModeChange,
  thinkingLevel,
  onThinkingLevelChange,
  availableThinkingLevels,
  thinkingLevelMap,
  toolPreset,
  onToolPresetChange,
  hasOpenFile,
  fileIncluded,
  onToggleFileIncluded,
  soundEnabled,
  onSoundToggle,
}: Props) {
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);

  // Close open dropdowns on any outside press.
  useEffect(() => {
    if (!thinkingDropdownOpen && !toolDropdownOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (thinkingDropdownOpen && !thinkingDropdownRef.current?.contains(t)) setThinkingDropdownOpen(false);
      if (toolDropdownOpen && !toolDropdownRef.current?.contains(t)) setToolDropdownOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [thinkingDropdownOpen, toolDropdownOpen]);

  const lvl = thinkingLevel ?? "auto";
  const mappedLvl = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
  const thinkingDisplayLabel = mappedLvl != null && mappedLvl !== lvl ? mappedLvl : lvl;
  const toolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default";

  const rowStyle = (disabled?: boolean, active = false): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 10px",
    background: "none",
    border: "none",
    borderRadius: 6,
    color: active ? "var(--accent)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
    textAlign: "left",
    transition: "background 0.12s, color 0.12s",
  });

  const hover = (e: React.MouseEvent<HTMLButtonElement>, disabled?: boolean) => {
    if (!disabled) e.currentTarget.style.background = "var(--bg-hover)";
  };
  const unhover = (e: React.MouseEvent<HTMLButtonElement>, disabled?: boolean, open = false) => {
    if (!open) e.currentTarget.style.background = "none";
    void disabled;
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: 8,
    right: 8,
    zIndex: 100,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
    overflow: "hidden",
    minWidth: 180,
  };

  const dropdownItemStyle = (isActive: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 12px",
    background: isActive ? "var(--bg-selected)" : "none",
    border: "none",
    color: isActive ? "var(--text)" : "var(--text-muted)",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left",
    fontWeight: isActive ? 600 : 400,
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0 6px 4px" }}>
      {/* Terminal safeguard */}
      {!isStreaming && onGuardChange && liveRemoteState?.guardEnabled !== undefined && (
        <button
          onClick={() => onGuardChange(!(liveRemoteState.guardEnabled === true))}
          title={`Terminal safeguard: ${liveRemoteState.guardEnabled ? "ON" : "OFF"} — click to turn ${liveRemoteState.guardEnabled ? "off" : "on"}`}
          aria-label="Toggle terminal safeguard"
          style={rowStyle(false, !!liveRemoteState.guardEnabled)}
          onMouseEnter={(e) => hover(e, false)}
          onMouseLeave={(e) => unhover(e, false)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={liveRemoteState.guardEnabled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          </svg>
          {liveRemoteState.guardEnabled ? "Guard" : "Unguarded"}
        </button>
      )}

      {/* Read/write mode */}
      {!isStreaming && onReadModeChange && liveRemoteState?.readMode !== undefined && (
        <button
          onClick={() => onReadModeChange(liveRemoteState.readMode === "read" ? "work" : "read")}
          title={`Terminal mode: ${liveRemoteState.readMode === "read" ? "READ-ONLY" : "write"} — click to switch`}
          aria-label="Toggle terminal read-only mode"
          style={rowStyle(false, liveRemoteState.readMode === "read")}
          onMouseEnter={(e) => hover(e, false)}
          onMouseLeave={(e) => unhover(e, false)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M12 7v14" />
            <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
          </svg>
          {liveRemoteState.readMode === "read" ? "READ" : "Write"}
        </button>
      )}

      {/* Reasoning level */}
      {!isStreaming && onThinkingLevelChange && (
        <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setThinkingDropdownOpen((v) => !v)}
            title={`Change reasoning level: ${thinkingDisplayLabel}`}
            aria-label="Change reasoning level"
            style={rowStyle(isStreaming, false)}
            onMouseEnter={(e) => hover(e, isStreaming)}
            onMouseLeave={(e) => unhover(e, isStreaming, thinkingDropdownOpen)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
              <line x1="7" y1="18" x2="12" y2="18" />
              <line x1="8" y1="21" x2="11" y2="21" />
            </svg>
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{thinkingDisplayLabel}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0, transform: thinkingDropdownOpen ? "rotate(180deg)" : "none" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {thinkingDropdownOpen && (
            <div style={dropdownStyle}>
              {THINKING_LEVELS.filter((l) => {
                if (!availableThinkingLevels) return true;
                if (l === "auto") return true;
                return availableThinkingLevels.includes(l);
              }).map((l) => {
                const isActive = lvl === l;
                const mappedVal = (l !== "auto" && thinkingLevelMap) ? thinkingLevelMap[l] : undefined;
                const displayLabel = (mappedVal != null && mappedVal !== l) ? mappedVal : l;
                const showOriginal = mappedVal != null && mappedVal !== l;
                return (
                  <button
                    key={l}
                    onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(l); }}
                    style={dropdownItemStyle(isActive)}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                  >
                    {isActive
                      ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                      : <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1 }}>
                      {displayLabel}
                      {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({l})</span>}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{THINKING_LEVEL_DESC[l]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tool preset */}
      {!isStreaming && onToolPresetChange && (
        <div ref={toolDropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setToolDropdownOpen((v) => !v)}
            title={`Change tool preset: ${toolPresetLabel}`}
            aria-label="Change tool preset"
            style={rowStyle(isStreaming, false)}
            onMouseEnter={(e) => hover(e, isStreaming)}
            onMouseLeave={(e) => unhover(e, isStreaming, toolDropdownOpen)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{toolPresetLabel}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" style={{ flexShrink: 0, transform: toolDropdownOpen ? "rotate(180deg)" : "none" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {toolDropdownOpen && (
            <div style={dropdownStyle}>
              {TOOL_PRESETS.map((t) => {
                const preset = TOOL_PRESET_MAP[t];
                const isActive = (toolPreset ?? "default") === preset;
                const desc = t === "off" ? "No tools, read-only" : t === "default" ? "4 built-in tools" : "All built-in tools";
                return (
                  <button
                    key={t}
                    onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                    style={dropdownItemStyle(isActive)}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                  >
                    {isActive
                      ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                      : <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1 }}>{t}</span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Open-file inclusion — session-scoped: once excluded the file stays
          out of chat prompts until toggled back on (not just the next one). */}
      {hasOpenFile && onToggleFileIncluded && (
        <button
          onClick={onToggleFileIncluded}
          title={fileIncluded
            ? "Open file is sent with chat prompts — click to exclude it for this session (until re-enabled)"
            : "Open file is excluded from chat prompts for this session — click to re-include it"}
          aria-label={fileIncluded ? "Exclude open file from chat for this session" : "Include open file with chat prompts"}
          style={rowStyle(false, !fileIncluded)}
          onMouseEnter={(e) => hover(e, false)}
          onMouseLeave={(e) => unhover(e, false)}
        >
          {fileIncluded ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="5" y1="21" x2="19" y2="3" />
            </svg>
          )}
          {fileIncluded ? "Open file: included" : "Open file: excluded"}
        </button>
      )}

      {/* Completion sound */}
      {onSoundToggle !== undefined && (
        <button
          onClick={onSoundToggle}
          title={soundEnabled ? "Disable completion sound" : "Enable completion sound"}
          aria-label={soundEnabled ? "Disable completion sound" : "Enable completion sound"}
          style={rowStyle(false, !!soundEnabled)}
          onMouseEnter={(e) => hover(e, false)}
          onMouseLeave={(e) => unhover(e, false)}
        >
          {soundEnabled ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
          Completion sound
        </button>
      )}
    </div>
  );
}

/** Store-connected variant: renders whatever ChatInput last published. */
export function ConnectedSessionControls() {
  const s = useSessionControls();
  if (!s) return null;
  return <SessionControls {...s} />;
}
