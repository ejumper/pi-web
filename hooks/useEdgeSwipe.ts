"use client";

import { useEffect, useRef } from "react";

// Touch starting within this many px of a physical screen edge arms a
// gesture. Both open and close are edge-triggered (from opposite edges), so
// every gesture gets the full screen width to travel across rather than a
// cramped 20px near a drawer's own boundary.
const EDGE_ZONE_PX = 20;
// Movement below this is ignored — lets a tap or the start of a vertical
// scroll near an edge pass through untouched.
const COMMIT_SLOP_PX = 10;
// How much more horizontal than vertical movement is required to treat this
// as a swipe rather than a scroll.
const DIRECTION_RATIO = 1.5;
// Fraction of screen width that counts as "far enough" to commit on release.
const DISTANCE_THRESHOLD = 0.35;
// A fast flick commits regardless of distance traveled (px/ms).
const VELOCITY_THRESHOLD = 0.5;

type Pane = "sidebar" | "rightPanel";
type Action = "open" | "close";

interface UseEdgeSwipeOptions {
  enabled: boolean;
  sidebarOpen: boolean;
  onSidebarOpenChange: (open: boolean) => void;
  rightPanelOpen: boolean;
  onRightPanelOpenChange: (open: boolean) => void;
  sidebarRef: React.RefObject<HTMLElement | null>;
  rightPanelRef: React.RefObject<HTMLElement | null>;
}

/**
 * Mobile swipe-to-open/close for the left sidebar and right file panel.
 * Left edge: drag right opens the sidebar (if closed) or closes the right
 * panel (if open). Right edge: drag left opens the right panel (if closed)
 * or closes the sidebar (if open) — same rule, mirrored.
 */
export function useEdgeSwipe(opts: UseEdgeSwipeOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let committed = false;
    let pane: Pane | null = null;
    let action: Action | null = null;
    let dir: 1 | -1 = 1; // expected sign of dx for this gesture to be valid

    const activeEl = (): HTMLElement | null =>
      pane === "sidebar" ? optsRef.current.sidebarRef.current : optsRef.current.rightPanelRef.current;

    const reset = (): void => {
      pointerId = null;
      committed = false;
      pane = null;
      action = null;
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType !== "touch" || pointerId !== null) return;
      const { sidebarOpen, rightPanelOpen } = optsRef.current;
      const x = e.clientX;
      const w = window.innerWidth;

      let candidatePane: Pane | null = null;
      let candidateAction: Action | null = null;
      let candidateDir: 1 | -1 = 1;

      if (x <= EDGE_ZONE_PX) {
        if (!sidebarOpen) { candidatePane = "sidebar"; candidateAction = "open"; candidateDir = 1; }
        else if (rightPanelOpen) { candidatePane = "rightPanel"; candidateAction = "close"; candidateDir = 1; }
      } else if (x >= w - EDGE_ZONE_PX) {
        if (!rightPanelOpen) { candidatePane = "rightPanel"; candidateAction = "open"; candidateDir = -1; }
        else if (sidebarOpen) { candidatePane = "sidebar"; candidateAction = "close"; candidateDir = -1; }
      }
      if (!candidatePane || !candidateAction) return;

      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startTime = e.timeStamp;
      pane = candidatePane;
      action = candidateAction;
      dir = candidateDir;
      committed = false;
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (pointerId === null || e.pointerId !== pointerId || !pane || !action) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!committed) {
        if (Math.abs(dx) < COMMIT_SLOP_PX) return;
        const horizontalDominant = Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO;
        const rightDirection = Math.sign(dx) === dir;
        if (!horizontalDominant || !rightDirection) {
          reset(); // not our gesture — let native scroll handle it
          return;
        }
        committed = true;
        const el = activeEl();
        if (el) el.style.transition = "none";
      }

      e.preventDefault();
      const el = activeEl();
      if (!el) return;
      const w = window.innerWidth;
      const progress = Math.min(1, Math.abs(dx) / w);
      let pct: number;
      if (pane === "sidebar") {
        // hidden = -100%, visible = 0
        pct = action === "open" ? -100 + progress * 100 : -progress * 100;
      } else {
        // hidden = 100%, visible = 0
        pct = action === "open" ? 100 - progress * 100 : progress * 100;
      }
      el.style.transform = `translateX(${pct}%)`;
    };

    const finish = (e: PointerEvent): void => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      if (!committed || !pane || !action) { reset(); return; }

      const dx = e.clientX - startX;
      const dt = Math.max(1, e.timeStamp - startTime);
      const w = window.innerWidth;
      const progress = Math.min(1, Math.abs(dx) / w);
      const velocity = Math.abs(dx) / dt;
      const crossed = progress > DISTANCE_THRESHOLD || velocity > VELOCITY_THRESHOLD;
      const finalOpen = action === "open" ? crossed : !crossed;

      const el = activeEl();
      const finishedPane = pane;
      if (el) el.style.transition = "";

      // Clear the inline transform on the next frame so the (just
      // re-enabled) CSS transition animates from the drag's last position to
      // the class-driven resting transform, instead of jumping instantly.
      requestAnimationFrame(() => {
        if (el) el.style.transform = "";
        if (finishedPane === "sidebar") optsRef.current.onSidebarOpenChange(finalOpen);
        else optsRef.current.onRightPanelOpenChange(finalOpen);
      });

      reset();
    };

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finish, { passive: true });
    window.addEventListener("pointercancel", finish, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [opts.enabled]);
}
