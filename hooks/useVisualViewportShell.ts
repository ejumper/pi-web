"use client";

import { useEffect } from "react";

/**
 * Fits the app shell to the *visible* screen area — the visual viewport minus
 * the on-screen keyboard — on every platform.
 *
 * iOS never shrinks the layout viewport for the keyboard
 * (interactive-widget=resizes-content is Android-only): it shrinks the
 * *visual* viewport and pans it to keep the caret visible. Anything that stays
 * layout-sized therefore loses its top to the pan (content slides under the
 * status bar / Dynamic Island, pinned bars bleed under scrolled content) while
 * its bottom sits behind the keyboard. Counter-translating individual bars
 * cannot fix that — when the caret is low (file editor) the pan is doing real
 * work and fighting it just makes iOS pan harder.
 *
 * So the shell is driven from the visual viewport directly:
 *   height:    vv.height              — exactly the visible band's height
 *   transform: translateY(vv.offsetTop) — into the band's position
 * i.e. the shell is always exactly the visible rectangle. The top safe-area
 * padding, top bars and content stay put, and the shell's bottom edge lands on
 * the keyboard's top edge — the composer sits above it with no per-element
 * nudging. With the keyboard closed this is a size-for-size no-op
 * (vv.height == the full screen, offsetTop == 0).
 *
 * The always-on transform (even translateY(0px)) also makes the shell the
 * containing block for its `position: fixed` descendants (drawer, modals,
 * file panel, dropdowns). They anchor to the shell box instead of the iOS
 * layout viewport — which resolves SHORT by the top safe-area inset in
 * installed PWAs (the "chin gap") — and track the band along with everything
 * else. Their geometry is unchanged: the shell box equals the screen box in
 * every state.
 *
 * iOS keyboard animation events are unreliable (resize/scroll can settle with
 * no final event), so a 250ms poll re-applies alongside the listeners; apply()
 * is idempotent and only writes on change.
 */
export function useVisualViewportShell(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    let raf = 0;
    let last = "";
    const apply = () => {
      raf = 0;
      const key = `${vv.height}|${vv.offsetTop}`;
      if (key === last) return;
      last = key;
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(apply);
    };

    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    const poll = setInterval(apply, 250);
    apply();

    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      clearInterval(poll);
      if (raf) cancelAnimationFrame(raf);
      el.style.height = "";
      el.style.transform = "";
    };
  }, [ref]);
}
