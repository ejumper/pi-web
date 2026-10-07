"use client";

import { useCallback, useRef } from "react";

interface Finger {
  /** current position */
  x: number;
  y: number;
  /** position when the finger went down */
  sx: number;
  sy: number;
}

interface UseTwoFingerGesturesOptions {
  /** One two-finger tap. Fired after the double-tap window closes. */
  onTap: () => void;
  /** Two two-finger taps in quick succession (promotes the pending pair). */
  onDoubleTap: () => void;
  /** Both fingers held down ~holdMs without moving much. */
  onHold: () => void;
  /** Max duration (ms) the fingers may stay down for it to count as a tap. */
  maxDurationMs?: number;
  /** Max movement (px) per finger before it's a drag, not a tap. */
  maxMovePx?: number;
  /** Max movement (px) per finger allowed during a hold (holds tolerate drift). */
  holdMaxMovePx?: number;
  /** How long (ms) both fingers must stay down to fire the hold. */
  holdMs?: number;
  /** How quickly (ms) a second tap must land to promote to a double-tap. */
  doubleTapWindowMs?: number;
}

/**
 * Two-finger gesture detector for touch devices — returns a ref callback to
 * put on an element. Procreate-style on the file editor:
 *
 *   two-finger tap        = undo
 *   two-finger double-tap = redo
 *   two-finger hold       = save
 *
 * Single-finger interaction is untouched (cursor placement, selection,
 * scrolling). A pinch or drag never qualifies as a tap. A 3-finger gesture's
 * tail never qualifies (the gesture must have involved exactly two fingers).
 *
 * Save lives on the two-finger layer deliberately: a single-finger
 * long-press on the editor trips iOS's text-selection loupe, which is
 * OS-driven and cannot be suppressed while keeping text selectable. Two
 * fingers never start a selection, so a hold is clean.
 *
 * Single taps are held for `doubleTapWindowMs` so a second tap can promote
 * the pair to a double-tap; a lone tap therefore fires a beat (~250ms)
 * after landing. A hold fires while the fingers are still down; the
 * subsequent lift is consumed so it can't also classify as a tap.
 *
 * Gesture state lives in a ref so the returned ref-callback stays
 * referentially stable — a callback ref that changed identity every render
 * would detach/re-attach the listeners constantly.
 */
export function useTwoFingerGestures({
  onTap,
  onDoubleTap,
  onHold,
  maxDurationMs = 300,
  maxMovePx = 12,
  holdMaxMovePx = 20,
  holdMs = 600,
  doubleTapWindowMs = 250,
}: UseTwoFingerGesturesOptions) {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;
  const maxDurationRef = useRef(maxDurationMs);
  maxDurationRef.current = maxDurationMs;
  const maxMoveRef = useRef(maxMovePx);
  maxMoveRef.current = maxMovePx;
  const holdMaxMoveRef = useRef(holdMaxMovePx);
  holdMaxMoveRef.current = holdMaxMovePx;
  const holdMsRef = useRef(holdMs);
  holdMsRef.current = holdMs;
  const doubleWindowRef = useRef(doubleTapWindowMs);
  doubleWindowRef.current = doubleTapWindowMs;
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef<{
    pointers: Map<number, Finger>;
    ended: Finger[];
    maxSimultaneous: number;
    twoFinger: boolean;
    startTime: number;
    moved: boolean;
    /** set when a hold fired — the gesture's remaining lifetime is consumed */
    consumed: boolean;
    holdTimer: ReturnType<typeof setTimeout> | null;
    node: HTMLElement | null;
    handlers: {
      down: (e: PointerEvent) => void;
      move: (e: PointerEvent) => void;
      up: (e: PointerEvent) => void;
      cancel: (e: PointerEvent) => void;
    } | null;
  }>({
    pointers: new Map(),
    ended: [],
    maxSimultaneous: 0,
    twoFinger: false,
    startTime: 0,
    moved: false,
    consumed: false,
    holdTimer: null,
    node: null,
    handlers: null,
  });

  return useCallback((node: HTMLElement | null) => {
    const s = stateRef.current;

    const clearHoldTimer = () => {
      if (s.holdTimer) {
        clearTimeout(s.holdTimer);
        s.holdTimer = null;
      }
    };

    // Tear down whatever we were previously bound to.
    if (s.node && s.handlers) {
      s.node.removeEventListener("pointerdown", s.handlers.down);
      s.node.removeEventListener("pointermove", s.handlers.move);
      s.node.removeEventListener("pointerup", s.handlers.up);
      s.node.removeEventListener("pointercancel", s.handlers.cancel);
      s.handlers = null;
    }
    clearHoldTimer();
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
    }
    s.pointers.clear();
    s.ended = [];
    s.maxSimultaneous = 0;
    s.twoFinger = false;
    s.consumed = false;
    s.node = node;
    if (!node) return;

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (s.pointers.size === 0) {
        // Fresh gesture — reset its trackers.
        s.ended = [];
        s.maxSimultaneous = 0;
        s.moved = false;
        s.consumed = false;
      }
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (s.pointers.size > s.maxSimultaneous) s.maxSimultaneous = s.pointers.size;
      if (s.pointers.size === 2) {
        s.twoFinger = true;
        s.startTime = e.timeStamp;
        // Arm the hold: both fingers down, timer decides.
        clearHoldTimer();
        s.holdTimer = setTimeout(() => {
          s.holdTimer = null;
          if (s.pointers.size === 2 && !s.consumed) {
            s.consumed = true;
            onHoldRef.current();
          }
        }, holdMsRef.current);
      } else if (s.pointers.size > 2) {
        // A third finger lands — no longer a clean two-finger hold.
        clearHoldTimer();
      }
    };

    const move = (e: PointerEvent) => {
      const p = s.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      const travel = Math.hypot(p.x - p.sx, p.y - p.sy);
      if (travel > maxMoveRef.current) s.moved = true;
      // Too much drift kills a pending hold (it's a drag/scroll now), but
      // holds tolerate more movement than taps do.
      if (s.holdTimer && travel > holdMaxMoveRef.current) clearHoldTimer();
    };

    const classifyTap = () => {
      // A pending tap means this is the second of a quick pair -> double-tap.
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
        onDoubleTapRef.current();
        return;
      }
      // Hold the single tap briefly so a quick second tap can promote it.
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        onTapRef.current();
      }, doubleWindowRef.current);
    };

    const up = (e: PointerEvent) => {
      const p = s.pointers.get(e.pointerId);
      if (!p) return;
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) clearHoldTimer(); // fingers lifted before the hold fired
      if (s.twoFinger) s.ended.push(p);
      if (s.pointers.size > 0 || !s.twoFinger) return;

      // Gesture complete (last finger lifted) and it involved two fingers.
      s.twoFinger = false;
      // A fired hold consumes the rest of the gesture — the lift must not
      // also classify as a tap.
      if (s.consumed) {
        s.consumed = false;
        return;
      }
      const duration = e.timeStamp - s.startTime;
      if (s.maxSimultaneous !== 2 || s.ended.length !== 2) return;

      if (!s.moved && duration <= maxDurationRef.current) classifyTap();
    };

    const cancel = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      if (s.pointers.size < 2) clearHoldTimer();
      if (s.pointers.size < 2) s.twoFinger = false;
    };

    s.handlers = { down, move, up, cancel };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
  }, []);
}
