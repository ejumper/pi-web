"use client";

import { useEffect } from "react";

/**
 * Lifts a bottom-anchored element (the chat composer) so it stays visible
 * above the on-screen keyboard on iOS.
 *
 * Inverse of useKeyboardAvoidPin: iOS never shrinks the *layout* viewport when
 * the keyboard opens (interactive-widget=resizes-content is Android-only) — it
 * only shrinks the visual viewport and pans it to keep the caret visible. So
 * everything in the layout viewport below `visualViewport.offsetTop +
 * visualViewport.height` sits behind the keyboard. Adding exactly that overflow
 * as margin-bottom puts the element's bottom edge at the keyboard's top edge;
 * with the keyboard closed the overflow is ≤ 0 and no margin is applied.
 *
 * Margin rather than transform on purpose: the composer contains a
 * `position: fixed` popup (the model dropdown), and a transformed ancestor
 * would re-anchor fixed descendants. Margin also shrinks the transcript above
 * instead of floating the composer over it (the composer background is
 * transparent, so overlap would show through).
 *
 * Measurement model (same as useKeyboardAvoidPin): getBoundingClientRect
 * reports layout coordinates — the rect does not move when the visual viewport
 * pans — so vv.offsetTop is folded in explicitly. The applied margin is added
 * back when measuring the unlifted bottom, or the measurement would feed on
 * its own output and oscillate. Re-applies on visualViewport resize/scroll so
 * the composer converges with iOS's own caret panning.
 */
export function useKeyboardAvoidLift(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    let raf = 0;
    let applied = 0;
    // Extra lift beyond the exact keyboard edge: the composer's bottom row
    // (send button) was landing a few px into the keyboard's clipped top edge
    // even with the math exact — enough cushion to always clear it.
    const LIFT_CUSHION_PX = 12;
    const apply = () => {
      raf = 0;
      const base = el.getBoundingClientRect().bottom + applied;
      const hidden = base - (vv.offsetTop + vv.height);
      const next = hidden > 0 ? hidden + LIFT_CUSHION_PX : 0;
      // Deadband: sub-pixel drift must not rewrite the margin every frame.
      if (Math.abs(next - applied) < 0.5) return;
      applied = next;
      el.style.marginBottom = next > 0 ? `${next}px` : "";
    };
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    // iOS keyboard pans do not reliably fire visualViewport events — the
    // keyboard can settle with no final event and leave the lift slightly
    // short. Poll as a fallback (the deadband keeps it a no-op when settled).
    const poll = setInterval(apply, 250);
    apply();

    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
      el.style.marginBottom = "";
    };
  }, [ref, enabled]);
}
