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
  /** Both fingers flicked upward. */
  onSwipeUp: () => void;
  /** Max duration (ms) the fingers may stay down for it to count as a tap. */
  maxDurationMs?: number;
  /** Max movement (px) per finger before it's a drag, not a tap. */
  maxMovePx?: number;
  /** Min upward travel (px) of BOTH fingers to count as a swipe up. */
  swipeMinPx?: number;
  /** How quickly (ms) a second tap must land to promote to a double-tap. */
  doubleTapWindowMs?: number;
}

/**
 * Two-finger gesture detector for touch devices — returns a ref callback to
 * put on an element. Procreate-style on the file editor:
 *
 *   two-finger tap        = undo
 *   two-finger double-tap = redo
 *   two-finger swipe up   = save
 *
 * Single-finger interaction is untouched (cursor placement, selection,
 * scrolling). A pinch or drag never qualifies as a tap — a pinch moves the
 * fingers toward/away from each other so it can't pass the "both fingers
 * traveled up" swipe test either. A 3-finger gesture's tail never qualifies
 * (the gesture must have involved exactly two fingers).
 *
 * Single taps are held for `doubleTapWindowMs` so a second tap can promote
 * the pair to a double-tap; a lone tap therefore fires a beat (~250ms)
 * after landing. Swipe-ups fire as soon as both fingers lift.
 *
 * Gesture state lives in a ref so the returned ref-callback stays
 * referentially stable — a callback ref that changed identity every render
 * would detach/re-attach the listeners constantly.
 */
export function useTwoFingerGestures({
  onTap,
  onDoubleTap,
  onSwipeUp,
  maxDurationMs = 300,
  maxMovePx = 12,
  swipeMinPx = 48,
  doubleTapWindowMs = 250,
}: UseTwoFingerGesturesOptions) {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;
  const onSwipeUpRef = useRef(onSwipeUp);
  onSwipeUpRef.current = onSwipeUp;
  const maxDurationRef = useRef(maxDurationMs);
  maxDurationRef.current = maxDurationMs;
  const maxMoveRef = useRef(maxMovePx);
  maxMoveRef.current = maxMovePx;
  const swipeMinRef = useRef(swipeMinPx);
  swipeMinRef.current = swipeMinPx;
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
    s.ended = [];
    s.maxSimultaneous = 0;
    s.twoFinger = false;
    s.node = node;
    if (!node) return;

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (s.pointers.size === 0) {
        // Fresh gesture — reset its trackers.
        s.ended = [];
        s.maxSimultaneous = 0;
        s.moved = false;
      }
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (s.pointers.size > s.maxSimultaneous) s.maxSimultaneous = s.pointers.size;
      if (s.pointers.size === 2) {
        s.twoFinger = true;
        s.startTime = e.timeStamp;
      }
    };

    const move = (e: PointerEvent) => {
      const p = s.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > maxMoveRef.current) s.moved = true;
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
      if (s.twoFinger) s.ended.push(p);
      if (s.pointers.size > 0 || !s.twoFinger) return;

      // Gesture complete (last finger lifted) and it involved two fingers.
      // Classify: swipe up first (it always sets `moved`, so it can never
      // also register as a tap), then tap.
      s.twoFinger = false;
      const duration = e.timeStamp - s.startTime;
      if (s.maxSimultaneous !== 2 || s.ended.length !== 2) return;

      // Swipe up: both fingers traveled up at least swipeMinPx with limited
      // sideways drift. A pinch moves the fingers in opposite directions, so
      // at most one can pass the "traveled up" test — pinches never fire.
      const [a, b] = s.ended;
      const swipedUp =
        a.sy - a.y >= swipeMinRef.current &&
        b.sy - b.y >= swipeMinRef.current &&
        Math.abs(a.x - a.sx) <= 40 &&
        Math.abs(b.x - b.sx) <= 40 &&
        duration <= 900;
      if (swipedUp) {
        onSwipeUpRef.current();
        return;
      }

      if (!s.moved && duration <= maxDurationRef.current) classifyTap();
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
