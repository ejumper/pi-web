import { NextResponse } from "next/server";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { openSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DESKTOP_HOST } from "@/lib/desktop-host";

const execFileAsync = promisify(execFile);

const STT_PORT = 8890;
const TTS_PORT = 8880;
const STT_START_SCRIPT = join(homedir(), "Audio-Visual", "Read-Aloud", "whisper-stt", "start-stt.sh");
const TTS_START_SCRIPT = join(homedir(), "Audio-Visual", "Read-Aloud", "start.sh");
// Neither script self-daemonizes (unlike the qwen/ornith launchers) — both
// just run uvicorn/python in the foreground — so stopping means pkill by
// the process's own command line rather than a built-in stop command.
const STT_STOP_PATTERN = "uvicorn server:app --host 0.0.0.0 --port 8890";
const TTS_STOP_PATTERN = "python -m api.main";
const LOG_DIR = join(homedir(), "models", "logs");

async function checkHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    let res: Response;
    try {
      res = await fetch(`http://${DESKTOP_HOST}:${port}/health`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    return res.ok;
  } catch {
    return false;
  }
}

function spawnDetached(script: string, logFile: string): void {
  const out = openSync(logFile, "a");
  const child = spawn("bash", [script], { detached: true, stdio: ["ignore", out, out] });
  child.unref();
}

// GET /api/voice-stack — status of both the STT and TTS services.
export async function GET() {
  const [sttRunning, ttsRunning] = await Promise.all([checkHealth(STT_PORT), checkHealth(TTS_PORT)]);
  return NextResponse.json({ sttRunning, ttsRunning });
}

// POST /api/voice-stack — spawns the local start scripts directly (not
// DESKTOP_HOST) — same caveat as local-model's POST: a remote/containerized
// instance can read status via GET but can't start/stop a desktop it isn't
// running on.
// Starts whichever of the two isn't already running.
// Both take real time to warm up (STT ~a few seconds, TTS ~15s) — this
// returns immediately after spawning; the client polls GET for readiness,
// same pattern as the local-model launcher.
export async function POST() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const [sttRunning, ttsRunning] = await Promise.all([checkHealth(STT_PORT), checkHealth(TTS_PORT)]);
    if (!sttRunning) spawnDetached(STT_START_SCRIPT, join(LOG_DIR, "whisper-stt.log"));
    if (!ttsRunning) spawnDetached(TTS_START_SCRIPT, join(LOG_DIR, "read-aloud.log"));
    return NextResponse.json({ success: true, started: { stt: !sttRunning, tts: !ttsRunning } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/voice-stack — stops both. Safe to call even if one/both are
// already stopped (pkill finding no match is treated as a no-op, not an error).
export async function DELETE() {
  await Promise.allSettled([
    execFileAsync("pkill", ["-f", STT_STOP_PATTERN]),
    execFileAsync("pkill", ["-f", TTS_STOP_PATTERN]),
  ]);
  return NextResponse.json({ success: true });
}
