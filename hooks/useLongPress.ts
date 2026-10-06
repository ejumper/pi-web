"use client";

import { useCallback, useRef } from "react";

interface Pos {
  x: number;
  y: number;
}

interface UseLongPressOptions<T> {
  /** Called when a touch is held still long enough on an element. */
  onLongPress: (node: T, pos: Pos) => void;
  /** ms of still touch before it fires. */
  delayMs?: number;
  /** px of movement (or any scroll) before it's cancelled. */
  movePx?: number;
}

interface LongPressHandlers<T> {
  onPointerDown: (e: React.PointerEvent, node: T) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  /** Call from the element's onClick: true = a long-press just fired, ignore the click. */
  swallowClick: () => boolean;
}

/**
 * Touch long-press detector — the "right click" for phones. iOS's native
 * contextmenu on long-press is unreliable (WebKit spends the long-press on
 * text selection and callouts, and behavior varies by version), so this
 * detects it manually: a touch held still for `delayMs` fires onLongPress
 * at the finger position and the trailing click is suppressed (so the
 * element's normal tap action doesn't also run). Any movement past
 * `movePx`, lifting, or scrolling cancels it — normal taps and scrolls are
 * untouched.
 *
 * Mouse and pen are ignored: desktop has real right-click.
 */
export function useLongPress<T>({
  onLongPress,
  delayMs = 500,
  movePx = 10,
}: UseLongPressOptions<T>): LongPressHandlers<T> {
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const stateRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; node: T | null; fired: boolean }>({
    timer: null,
    x: 0,
    y: 0,
    node: null,
    fired: false,
  });

  const cancel = useCallback(() => {
    const s = stateRef.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent, node: T) => {
    if (e.pointerType !== "touch") return;
    const s = stateRef.current;
    s.fired = false;
    s.node = node;
    s.x = e.clientX;
    s.y = e.clientY;
    cancel();
    s.timer = setTimeout(() => {
      s.timer = null;
      s.fired = true;
      if (s.node !== null) onLongPressRef.current(s.node, { x: s.x, y: s.y });
    }, delayMs);
  }, [cancel, delayMs]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;
    if (!s.timer) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > movePx) cancel();
  }, [cancel, movePx]);

  const onPointerUp = useCallback(() => cancel(), [cancel]);
  const onPointerCancel = useCallback(() => cancel(), [cancel]);

  const swallowClick = useCallback(() => {
    const s = stateRef.current;
    if (s.fired) {
      s.fired = false;
      return true;
    }
    return false;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, swallowClick };
}
