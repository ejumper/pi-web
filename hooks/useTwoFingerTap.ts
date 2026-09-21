"use client";

import { useCallback, useRef } from "react";

interface UseTwoFingerTapOptions {
  onTap: () => void;
  enabled?: boolean;
  /** Max time (ms) the two fingers may stay down for it to count as a tap. */
  maxDurationMs?: number;
  /** Max distance (px) either finger may travel before it's a drag, not a tap. */
  maxMovePx?: number;
}

/**
 * Two-finger tap detector for touch devices — returns a ref callback to put
 * on an element. Fires `onTap` when exactly two fingers tap (down then up)
 * quickly and without moving. A pinch or drag (fingers moving) never
 * qualifies, and single-finger taps are ignored so normal cursor placement
 * and text selection still work. Used for "two-finger tap = save" in the
 * file editor, where a phone has no ctrl+S.
 *
 * Gesture state lives in a ref so the returned ref-callback stays
 * referentially stable — a callback ref that changed identity every render
 * would detach/re-attach the listeners constantly.
 */
export function useTwoFingerTap({
  onTap,
  enabled = true,
  maxDurationMs = 300,
  maxMovePx = 12,
}: UseTwoFingerTapOptions) {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const maxDurationRef = useRef(maxDurationMs);
  maxDurationRef.current = maxDurationMs;
  const maxMoveRef = useRef(maxMovePx);
  maxMoveRef.current = maxMovePx;

  const stateRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    maxSimultaneous: number;
    twoFinger: boolean;
    startTime: number;
    moved: boolean;
    node: HTMLElement | null;
    handlers: {
      down: (e: PointerEvent) => void;
      move: (e: PointerEvent) => void;
      up: (e: PointerEvent) => void;
      cancel: (e: PointerEvent) => void;
    } | null;
  }>({
    pointers: new Map(),
    maxSimultaneous: 0,
    twoFinger: false,
    startTime: 0,
    moved: false,
    node: null,
    handlers: null,
  });

  return useCallback((node: HTMLElement | null) => {
    const s = stateRef.current;

    // Tear down whatever we were previously bound to.
    if (s.node && s.handlers) {
      s.node.removeEventListener("pointerdown", s.handlers.down);
      s.node.removeEventListener("pointermove", s.handlers.move);
      s.node.removeEventListener("pointerup", s.handlers.up);
      s.node.removeEventListener("pointercancel", s.handlers.cancel);
      s.handlers = null;
    }
    s.pointers.clear();
    s.maxSimultaneous = 0;
    s.twoFinger = false;
    s.node = node;
    if (!node) return;

    const down = (e: PointerEvent) => {
      if (!enabledRef.current || e.pointerType !== "touch") return;
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size > s.maxSimultaneous) s.maxSimultaneous = s.pointers.size;
      if (s.pointers.size === 2) {
        s.twoFinger = true;
        s.startTime = e.timeStamp;
        s.moved = false;
      }
    };

    const move = (e: PointerEvent) => {
      const p = s.pointers.get(e.pointerId);
      if (!p) return;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > maxMoveRef.current) s.moved = true;
    };

    const up = (e: PointerEvent) => {
      if (!s.pointers.has(e.pointerId)) return;
      // Fire on the first of the two fingers lifting: still exactly two down,
      // the gesture never grew past two fingers, it didn't move, and it was
      // brief. (maxSimultaneous === 2 guards against a 3-finger gesture's
      // tail looking like a 2-finger tap.)
      const qualifies =
        s.twoFinger && s.pointers.size === 2 && s.maxSimultaneous === 2 &&
        !s.moved && e.timeStamp - s.startTime <= maxDurationRef.current;
      s.pointers.delete(e.pointerId);
      if (qualifies) onTapRef.current();
      if (s.pointers.size < 2) s.twoFinger = false;
    };

    const cancel = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) s.twoFinger = false;
    };

    s.handlers = { down, move, up, cancel };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
  }, []);
}
