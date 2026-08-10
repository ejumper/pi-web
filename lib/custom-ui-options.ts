/**
 * Reading `overlayOptions` off an extension's `ctx.ui.custom` call.
 *
 * pi-tui resolves these against a real terminal. There isn't one here, so the
 * two fields that survive translation are the width (which the client later
 * overrides with its measured column count) and `nonCapturing`, which decides
 * whether the panel is drawn as a modal scrim or docked above the composer.
 *
 * Split out of rpc-manager so it can be tested against the option objects
 * extensions actually pass, rather than asserted against source text.
 */

export const CUSTOM_UI_MIN_COLS = 40;
export const CUSTOM_UI_MAX_COLS = 140;
export const CUSTOM_UI_DEFAULT_COLS = 92;

/** Nominal terminal width a percentage is resolved against. */
const NOMINAL_COLS = 100;

export interface ResolvedCustomUiOptions {
  width: number;
  nonCapturing: boolean;
}

export function clampCustomUiCols(cols: number): number {
  if (!Number.isFinite(cols)) return CUSTOM_UI_DEFAULT_COLS;
  return Math.max(CUSTOM_UI_MIN_COLS, Math.min(CUSTOM_UI_MAX_COLS, Math.round(cols)));
}

/** `overlayOptions` may be a function, an object, or absent. */
function resolveOverlayOptions(options: unknown): Record<string, unknown> | undefined {
  if (!options || typeof options !== "object") return undefined;
  const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
  const resolved = typeof overlayOptions === "function"
    ? (overlayOptions as () => unknown)()
    : overlayOptions;
  return resolved && typeof resolved === "object" ? (resolved as Record<string, unknown>) : undefined;
}

/**
 * Width accepts a number, a numeric string, or a percentage ("94%") — the last
 * of which is what pi's own extensions use, and what the previous numeric-only
 * check silently discarded.
 */
function resolveWidth(raw: unknown): number {
  if (typeof raw === "number") return clampCustomUiCols(raw);
  if (typeof raw !== "string") return CUSTOM_UI_DEFAULT_COLS;

  const trimmed = raw.trim();
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(trimmed);
  if (percent) return clampCustomUiCols((Number(percent[1]) / 100) * NOMINAL_COLS);

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && trimmed !== "" ? clampCustomUiCols(numeric) : CUSTOM_UI_DEFAULT_COLS;
}

export function resolveCustomUiOptions(options: unknown): ResolvedCustomUiOptions {
  const resolved = resolveOverlayOptions(options);
  if (!resolved) return { width: CUSTOM_UI_DEFAULT_COLS, nonCapturing: false };
  return {
    width: resolveWidth(resolved.width),
    nonCapturing: resolved.nonCapturing === true,
  };
}
