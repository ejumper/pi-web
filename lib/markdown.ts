import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "object", "style", "form"],
};

// singleDollarTextMath is ON by default, which makes remark-math treat `$…$` as
// inline math. Any two dollar amounts in one reply ("$20/month … $17/month")
// therefore get swallowed into a single KaTeX formula: small italic serif
// glyphs, whitespace collapsed, surrounding markdown emphasis rendered as
// literal `*`, and copy/paste exploding into one <span> per character.
// Turning it off leaves `$$…$$` display math (see normalizeDisplayMath) fully
// working; only bare `$…$` inline math stops being parsed, which is the right
// trade for a chat surface where prices are common.
export const markdownRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];
export const markdownPreviewRemarkPlugins: ReactMarkdownOptions["remarkPlugins"] = [remarkGfm];

export const markdownRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

export const markdownPreviewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
];
