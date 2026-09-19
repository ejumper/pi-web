"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

// Layout effects don't exist during SSR.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Drives the transcript's bottom spacer so a just-sent user message can sit near
 * the top of the viewport while the reply is still short — without leaving dead
 * space once the reply has grown.
 *
 * The spacer used to be a fixed viewport height for the entire run. Max scroll
 * therefore ended one viewport *past* the end of the content, so while the agent
 * ran, bottom-pinning parked the reader on a blank screen with the actual reply
 * pushed off the top of the page.
 *
 * Instead the spacer is only ever as tall as the shortfall between one viewport
 * and the content that already exists below the last user message. It shrinks as
 * the reply streams and reaches 0 the moment the content fills the screen, so the
 * end of the scroll range lands on the last line of content — the same place it
 * lands once the run finishes.
 *
 * The height is written straight to the element rather than held in React state:
 * this recomputes on every streamed chunk, and a re-render per chunk is wasted
 * work (and visible jitter) for something that is pure layout.
 */
export function useStreamingSpacer<
  TContainer extends HTMLElement,
  TAnchor extends HTMLElement,
>(
  enabled: boolean,
  containerRef: RefObject<TContainer | null>,
  anchorRef: RefObject<TAnchor | null>,
): RefObject<HTMLDivElement | null> {
  const spacerRef = useRef<HTMLDivElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    const initial = spacerRef.current;
    if (!enabled) {
      if (initial) initial.style.height = "0px";
      return;
    }
    if (!initial || !containerRef.current) return;

    let last = -1;

    const apply = () => {
      const container = containerRef.current;
      const spacer = spacerRef.current;
      if (!container || !spacer) return;

      const viewport = container.clientHeight;
      if (viewport === 0) return;

      // No anchor in this scroller (continuation/branch runs, or the message has
      // scrolled out of the render window) — nothing to make room for.
      const anchor = anchorRef.current;
      if (!anchor || !container.contains(anchor)) {
        if (last !== 0) {
          last = 0;
          spacer.style.height = "0px";
        }
        return;
      }

      const applied = spacer.offsetHeight;
      // Bottom of everything above the spacer, in scroll-content coordinates.
      // Subtracting the spacer's own height keeps this independent of the value
      // we are about to write, so the ResizeObserver we install below cannot feed
      // its own change back into the measurement.
      const contentBottom = container.scrollHeight - applied;
      const anchorTop =
        anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      const below = contentBottom - anchorTop;
      const next = Math.max(0, Math.min(viewport - below, viewport));

      // Deadband: sub-pixel drift from line-height rounding must not count as a
      // change, or the observer would keep rewriting the height.
      if (Math.abs(next - last) <= 1) return;
      last = next;
      spacer.style.height = `${next}px`;
    };

    apply();

    // The content wrapper (the spacer's parent) is what actually grows as the
    // reply streams; the scroller's own box does not change.
    const ro = new ResizeObserver(apply);
    const content = initial.parentElement;
    if (content) ro.observe(content);

    window.addEventListener("resize", apply);
    // Keyboard open/close surfaces as a visualViewport resize, not a window one.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
      vv?.removeEventListener("resize", apply);
    };
  }, [enabled, containerRef, anchorRef]);

  return spacerRef;
}
