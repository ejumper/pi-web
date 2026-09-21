"use client";

import { useEffect } from "react";

/**
 * Pins an element just above the on-screen keyboard on mobile.
 *
 * A vertically-centered composer (the empty-session prompt) jumps/scrolls
 * when the keyboard opens: the visual viewport shrinks and iOS pans it, so
 * the centered content keeps re-centering against a moving target. This
 * lifts the element out of flow (position: fixed) and anchors it to the
 * top edge of the keyboard while the keyboard is open, then reverts it to
 * normal flow when the keyboard closes.
 *
 * Complements useKeyboardAvoidPin (which pins elements to the TOP by
 * counter-translating visualViewport.offsetTop) — this one aims at the
 * bottom. Keyboard height is the gap between the layout viewport and the
 * visible viewport:
 *
 *   keyboardHeight = innerHeight - vv.height - vv.offsetTop
 *
 * On Android with `interactive-widget=resizes-content` (set in the
 * viewport meta) the layout viewport already shrinks for the keyboard, so
 * keyboardHeight computes to ~0 and this stays inert — the meta tag does
 * the work there. On iOS, which ignores that directive, this hook is what
 * keeps the composer above the keyboard.
 */
export function useKeyboardAbovePin(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    const clear = () => {
      el.style.position = "";
      el.style.bottom = "";
      el.style.left = "";
      el.style.right = "";
      el.style.zIndex = "";
    };

    let raf = 0;
    const apply = () => {
      raf = 0;
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop;
      if (keyboardHeight > 100) {
        // Lift the composer out of flow and rest it 8px above the keyboard.
        el.style.position = "fixed";
        el.style.bottom = `${keyboardHeight + 8}px`;
        el.style.left = "16px";
        el.style.right = "16px";
        el.style.zIndex = "60";
      } else {
        clear();
      }
    };
    const onChange = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };

    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    apply();

    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      if (raf) cancelAnimationFrame(raf);
      clear();
    };
  }, [ref, enabled]);
}
