"use client";

import { useEffect } from "react";

/**
 * Counter-transforms a fixed header-ish element so it stays visually pinned
 * to the top of the screen when the on-screen keyboard opens.
 *
 * iOS pans the *visual* viewport downward (not the document) to keep the
 * focused caret visible, and every element on screen appears to shift with
 * it regardless of its own CSS position — `position: fixed` alone doesn't
 * help, because fixed elements are anchored to the *layout* viewport, which
 * hasn't moved. Reading `visualViewport.offsetTop` and translating this
 * element by that amount cancels the pan just for it, while the editor
 * content below is left alone to shift, which is the actual desired
 * keyboard-avoidance behavior for the caret.
 */
export function useKeyboardAvoidPin(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    let raf = 0;
    let lastOffset = -1;
    const apply = () => {
      raf = 0;
      const offset = vv.offsetTop;
      if (offset === lastOffset) return;
      lastOffset = offset;
      el.style.transform = offset ? `translateY(${offset}px)` : "";
    };
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    // iOS keyboard pans do not reliably fire visualViewport scroll events —
    // the pan can settle with no event at all and strand the element off the
    // top until the user happens to scroll. Poll as a fallback (cheap: apply
    // is idempotent and only rewrites on an offset change).
    const poll = setInterval(apply, 250);
    apply();

    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
      el.style.transform = "";
    };
  }, [ref, enabled]);
}
