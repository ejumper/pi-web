import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./custom-ui-options.ts");
}

test("reads the option object pi's own extensions pass", async () => {
  const { resolveCustomUiOptions } = await loadSubject();

  // Verbatim from extensions/btw: a percentage width and nonCapturing, which
  // the previous numeric-only check dropped on the floor.
  const resolved = resolveCustomUiOptions({
    overlay: true,
    overlayOptions: { anchor: "top-center", width: "94%", margin: 1, nonCapturing: true },
    onHandle: () => {},
  });

  assert.equal(resolved.nonCapturing, true);
  assert.equal(resolved.width, 94);
});

test("defaults to a capturing modal when nothing says otherwise", async () => {
  const { resolveCustomUiOptions, CUSTOM_UI_DEFAULT_COLS } = await loadSubject();

  for (const options of [undefined, null, {}, { overlayOptions: undefined }, { overlayOptions: 7 }]) {
    const resolved = resolveCustomUiOptions(options);
    assert.equal(resolved.nonCapturing, false, `for ${JSON.stringify(options)}`);
    assert.equal(resolved.width, CUSTOM_UI_DEFAULT_COLS);
  }
});

test("nonCapturing must be exactly true, not merely truthy", async () => {
  const { resolveCustomUiOptions } = await loadSubject();

  assert.equal(resolveCustomUiOptions({ overlayOptions: { nonCapturing: 1 } }).nonCapturing, false);
  assert.equal(resolveCustomUiOptions({ overlayOptions: { nonCapturing: "yes" } }).nonCapturing, false);
  assert.equal(resolveCustomUiOptions({ overlayOptions: { nonCapturing: true } }).nonCapturing, true);
});

test("overlayOptions may be a thunk", async () => {
  const { resolveCustomUiOptions } = await loadSubject();

  const resolved = resolveCustomUiOptions({
    overlayOptions: () => ({ width: 120, nonCapturing: true }),
  });

  assert.equal(resolved.width, 120);
  assert.equal(resolved.nonCapturing, true);
});

test("width accepts numbers, numeric strings and percentages", async () => {
  const { resolveCustomUiOptions, CUSTOM_UI_DEFAULT_COLS } = await loadSubject();
  const width = (value) => resolveCustomUiOptions({ overlayOptions: { width: value } }).width;

  assert.equal(width(100), 100);
  assert.equal(width("100"), 100);
  assert.equal(width("50%"), 50);
  assert.equal(width("50 %"), 50);
  assert.equal(width("94%"), 94);
  // Unparseable input falls back rather than producing NaN columns.
  assert.equal(width("wide"), CUSTOM_UI_DEFAULT_COLS);
  assert.equal(width(""), CUSTOM_UI_DEFAULT_COLS);
  assert.equal(width(Number.NaN), CUSTOM_UI_DEFAULT_COLS);
  assert.equal(width(undefined), CUSTOM_UI_DEFAULT_COLS);
});

test("width is clamped so a panel can never render at an unusable size", async () => {
  const { resolveCustomUiOptions, clampCustomUiCols, CUSTOM_UI_MIN_COLS, CUSTOM_UI_MAX_COLS } = await loadSubject();
  const width = (value) => resolveCustomUiOptions({ overlayOptions: { width: value } }).width;

  assert.equal(width(1), CUSTOM_UI_MIN_COLS);
  assert.equal(width(9999), CUSTOM_UI_MAX_COLS);
  assert.equal(width("1%"), CUSTOM_UI_MIN_COLS);
  assert.equal(width("400%"), CUSTOM_UI_MAX_COLS);

  // Same clamp guards the client-reported column count, so a phone reporting a
  // narrow viewport cannot drive the renderer below its minimum.
  assert.equal(clampCustomUiCols(3), CUSTOM_UI_MIN_COLS);
  assert.equal(clampCustomUiCols(1e6), CUSTOM_UI_MAX_COLS);
  assert.equal(clampCustomUiCols(80.4), 80);
  assert.equal(clampCustomUiCols(Number.NaN), 92);
});

test("a docked panel and a permission dialog cannot fight over the top layer", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");

  const dialogZ = /function ExtensionDialog\b[\s\S]*?zIndex: (\d+)/.exec(source);
  const modalZ = /function ExtensionCustomPanel\b[\s\S]*?zIndex: (\d+)/.exec(source);

  assert.ok(dialogZ, "ExtensionDialog should declare a z-index");
  assert.ok(modalZ, "ExtensionCustomPanel should declare a z-index");
  // pi-safeguard asks for shell approval through ctx.ui.select. If an
  // extension's own panel can cover that, the agent blocks on a prompt the
  // user cannot reach.
  assert.ok(
    Number(dialogZ[1]) > Number(modalZ[1]),
    `permission dialogs (${dialogZ[1]}) must sit above custom panels (${modalZ[1]})`,
  );
});

test("dialog titles keep the line structure callers put in them", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const dialog = source.slice(source.indexOf("function ExtensionDialog"));
  const title = dialog.slice(0, dialog.indexOf("extension request"));

  // pi-safeguard puts the command being approved on its own line inside the
  // title; without pre-wrap the browser collapses it into a run-on paragraph.
  assert.match(title, /whiteSpace: "pre-wrap"/);
});
