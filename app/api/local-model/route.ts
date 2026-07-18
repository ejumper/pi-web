import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
import { DESKTOP_HOST } from "@/lib/desktop-host";

const execFileAsync = promisify(execFile);

// Keys match the launcher script names in ~/.local/bin exactly (symlinks into
// ~/models/scripts/qwen and ~/models/scripts/ornith) and the -a alias each
// script passes to llama-server, so /v1/models' data[0].id can be compared
// directly against these keys to tell which one is currently running.
const LOCAL_MODEL_IDS = ["qwen35b", "qwen9b", "qwen122b", "qwen35bu", "ornith35b"] as const;
type LocalModelId = (typeof LOCAL_MODEL_IDS)[number];

const LOCAL_MODEL_PORT = 8080;

function isLocalModelId(value: unknown): value is LocalModelId {
  return typeof value === "string" && (LOCAL_MODEL_IDS as readonly string[]).includes(value);
}

// The launcher scripts' status check shells out to `pgrep -af`, whose output
// includes the full `podman exec --env=KEY=VALUE ...` command lines distrobox
// uses to forward the host environment into the container — which can include
// live secrets (API keys, tokens) that happen to be set in the shell. Strip
// those lines before this ever reaches the client; only the plain
// Starting/Model/Log/Health summary lines are safe to show.
function sanitizeScriptOutput(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/--env=|podman exec|distrobox enter/.test(line))
    .join("\n")
    .trim();
}

// GET /api/local-model — probes the shared llama-server port directly (no
// need to shell into distrobox) via its OpenAI-compatible /v1/models, whose
// data[0].id is the -a alias the launcher scripts set.
export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    let res: Response;
    try {
      res = await fetch(`http://${DESKTOP_HOST}:${LOCAL_MODEL_PORT}/v1/models`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return NextResponse.json({ running: false });
    const data = (await res.json()) as { data?: { id?: string }[] };
    const model = data.data?.[0]?.id ?? null;
    return NextResponse.json({ running: true, model });
  } catch {
    return NextResponse.json({ running: false });
  }
}

// POST /api/local-model  body: { model: string }
// Always runs against the local filesystem (execFile, not DESKTOP_HOST) — a
// containerized instance pointed at a remote desktop can only probe (GET),
// not start/stop, since the launcher scripts live on the desktop's disk.
// Runs the matching launcher script exactly as it'd be run from the CLI
// (`~/.local/bin/<model> --background`). The script itself stops any
// existing llama-server before starting the new one and self-daemonizes
// (nohup + disown) before this invocation exits, so a plain awaited
// execFile is enough — no detaching needed on our end.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { model?: unknown };
    if (!isLocalModelId(body.model)) {
      return NextResponse.json({ error: "Unknown model" }, { status: 400 });
    }
    const bin = join(homedir(), ".local", "bin", body.model);
    const { stdout, stderr } = await execFileAsync(bin, ["--background"], { timeout: 30_000 });
    return NextResponse.json({ success: true, output: sanitizeScriptOutput(`${stdout}${stderr}`) });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = sanitizeScriptOutput([err.stdout, err.stderr].filter(Boolean).join("\n"));
    return NextResponse.json({ error: output || err.message || String(error) }, { status: 500 });
  }
}

// DELETE /api/local-model  body: { model: string }
// Stops the running server via the matching family's stop script (qwen-stop
// / ornith-stop — both just pkill llama-server inside the shared distrobox,
// so either works regardless of which model is running, but calling the
// matching one keeps this consistent with "run it like the CLI would").
export async function DELETE(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { model?: unknown };
    const model = typeof body.model === "string" ? body.model : "";
    const stopCmd = model.startsWith("ornith") ? "ornith-stop" : "qwen-stop";
    const bin = join(homedir(), ".local", "bin", stopCmd);
    const { stdout, stderr } = await execFileAsync(bin, [], { timeout: 15_000 });
    return NextResponse.json({ success: true, output: sanitizeScriptOutput(`${stdout}${stderr}`) });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = sanitizeScriptOutput([err.stdout, err.stderr].filter(Boolean).join("\n"));
    return NextResponse.json({ error: output || err.message || String(error) }, { status: 500 });
  }
}
