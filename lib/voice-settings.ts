import { readFileSync, writeFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Lives alongside the agent's own config (models.json, settings.json, etc.)
// in ~/.pi/agent/ — that directory is already pi-web's de facto data dir.
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "pi-web-voice.json");
const DEFAULT_VOICE = "clone:emma_w";

export function getSelectedVoice(): string {
  try {
    if (!existsSync(SETTINGS_PATH)) return DEFAULT_VOICE;
    const data = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as { voice?: string };
    return data.voice || DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function setSelectedVoice(voice: string): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify({ voice }, null, 2));
}
