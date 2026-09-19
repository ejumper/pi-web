import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { MarkdownBody } = await jiti.import("./MarkdownBody.tsx");

function renderMarkdown(markdown) {
  return renderToStaticMarkup(
    React.createElement(MarkdownBody, {
      cwd: "/home/me/project",
      onOpenFile() {},
    }, markdown),
  );
}

test("opens non-file markdown links in a safe new tab", () => {
  const html = renderMarkdown("[docs](https://example.com/docs)");

  assert.match(
    html,
    /<a (?=[^>]*href="https:\/\/example\.com\/docs")(?=[^>]*target="_blank")(?=[^>]*rel="noopener noreferrer")[^>]*>docs<\/a>/,
  );
  assert.doesNotMatch(html, /\snode=/);
});

test("keeps local file markdown links in the app", () => {
  const html = renderMarkdown("[file](components/MarkdownBody.tsx)");

  assert.match(html, /<a href="components\/MarkdownBody\.tsx">file<\/a>/);
  assert.doesNotMatch(html, /target=|rel=|\snode=/);
});

test("dollar amounts are not parsed as inline math", () => {
  const html = renderMarkdown(
    "**Claude Pro is $20/month when billed monthly** (or $17/month, billed annually at $200/year).",
  );

  // Regression: with remark-math's default singleDollarTextMath the span between
  // the first two `$` became one KaTeX formula — italic serif glyphs, the `**`
  // rendered literally, and one <span> per character on copy/paste.
  assert.doesNotMatch(html, /katex/i);
  assert.match(html, /<strong>Claude Pro is \$20\/month when billed monthly<\/strong>/);
  assert.match(html, /\$17\/month/);
  assert.match(html, /\$200\/year/);
});

test("$$ display math still renders", () => {
  const html = renderMarkdown("$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$");

  assert.match(html, /class="katex-display"/);
});
