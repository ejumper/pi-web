import type { Extension } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

const cache = new Map<string, Promise<Extension>>();

/** Lazily loads and caches a CM6 language mode by matching the file's name/extension. Returns null if no match. */
export function loadLanguageForFile(filePath: string): Promise<Extension> | null {
  const desc = LanguageDescription.matchFilename(languages, filePath);
  if (!desc) return null;

  let cached = cache.get(desc.name);
  if (!cached) {
    cached = desc.load();
    cache.set(desc.name, cached);
  }
  return cached;
}
