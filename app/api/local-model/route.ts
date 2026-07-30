import { NextResponse } from "next/server";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { homedir } from "os";
import { DESKTOP_HOST } from "@/lib/desktop-host";
import { readLocalModelCatalog } from "@/lib/local-models";

const execFileAsync = promisify(execFile);

// Everything startable is now driven by `addie`, which brings up a main model
// on :8080 *and* the judge instance on :7979 together (see second-model.md).
// The model list is no longer hardcoded here — it comes from the catalog addie
// writes on every run. See lib/local-models.ts.
const ADDIE_BIN = join(homedir(), ".local", "bin", "addie");

// When pi-web runs somewhere other than the desktop (the server's container),
// the launcher scripts don't exist on its disk — only the desktop can actually
// start or stop anything. Status probes work remotely over the network, but
// start/stop get forwarded to the desktop's own pi-web, which does the exec
// locally.
//
// No auth token on this hop, deliberately: pi-web has no auth layer at all (no
// middleware, no session), so its agent can already run arbitrary bash for
// anyone who can reach the port. Forwarding to an endpoint that is already
// openly reachable adds no exposure that didn't exist, and a token the
// browser UI would also have to send would be readable by exactly the same
// people. What protects this is network reachability (LAN/tailnet), not a
// shared secret. See pi-web.md.
const IS_REMOTE = DESKTOP_HOST !== "127.0.0.1" && DESKTOP_HOST !== "localhost";
const DESKTOP_PI_WEB_PORT = process.env.DESKTOP_PI_WEB_PORT || "30141";
const DESKTOP_API = `http://${DESKTOP_HOST}:${DESKTOP_PI_WEB_PORT}/api/local-model`;

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

async function probePort(port: number): Promise<{ running: boolean; model: string | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    let res: Response;
    try {
      res = await fetch(`http://${DESKTOP_HOST}:${port}/v1/models`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) return { running: false, model: null };
    const data = (await res.json()) as { data?: { id?: string }[] };
    return { running: true, model: data.data?.[0]?.id ?? null };
  } catch {
    return { running: false, model: null };
  }
}

async function forward(method: "POST" | "DELETE", body: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(DESKTOP_API, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const d = await res.json().catch(() => ({}));
    return NextResponse.json(d, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach the desktop at ${DESKTOP_HOST}:${DESKTOP_PI_WEB_PORT} — is it awake and is pi-web running? (${String(e)})` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

// GET /api/local-model — catalog plus live status of both ports. data[0].id on
// each port is the -a alias the launcher set, which is what `alias` in the
// catalog matches against.
export async function GET() {
  const catalog = await readLocalModelCatalog();
  const [main, judge] = await Promise.all([
    probePort(catalog.mainPort),
    probePort(catalog.judge.port),
  ]);
  return NextResponse.json({
    models: catalog.models,
    mainPort: catalog.mainPort,
    judge: { ...catalog.judge, ...judge },
    main,
  });
}

// POST /api/local-model  body: { key: string, noJudge?: boolean }
// Runs `addie <key>`, which starts the main model AND the judge.
//
// Spawned detached rather than awaited: addie deliberately blocks polling
// /health until each server reports ready (up to ADDIE_READY_TIMEOUT, 300s by
// default), which a 35B/122B load will routinely exceed. Awaiting it here
// would time the request out while the model was in fact loading fine. The UI
// polls GET instead, which is what actually reflects readiness.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; noJudge?: unknown };
  const key = typeof body.key === "string" ? body.key : "";
  const noJudge = body.noJudge === true;

  const catalog = await readLocalModelCatalog();
  if (!catalog.models.some((m) => m.key === key)) {
    return NextResponse.json({ error: `Unknown model key: ${key || "(none)"}` }, { status: 400 });
  }

  if (IS_REMOTE) return forward("POST", { key, noJudge });

  try {
    const args = noJudge ? [key, "--no-judge"] : [key];
    // stdio is discarded on purpose. The obvious thing — redirecting it to a
    // log so a failed background start is diagnosable — cannot be done safely
    // here: the launcher scripts' status check shells out to `pgrep -af`,
    // whose output contains the full `podman exec --env=KEY=VALUE ...` lines
    // carrying the entire host environment, secrets included (see
    // sanitizeScriptOutput above, and the note in pi-web.md). Writing that
    // straight to a file would recreate exactly the leak that function exists
    // to prevent, and a raw fd redirect gives no place to filter it.
    //
    // Nothing is lost: llama-server already logs to ~/models/logs/<alias>.log
    // via the launcher itself, which is the useful log anyway.
    const child = spawn(ADDIE_BIN, args, { detached: true, stdio: "ignore" });
    child.unref();
    return NextResponse.json({
      started: true,
      key,
      message: `Starting ${key} (main + ${noJudge ? "no judge" : "judge"}). Large models take a few minutes to load — status updates below as they come up. Server logs: ~/models/logs/`,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/local-model — `addie stop`, which is port-scoped and takes down
// BOTH the main model and the judge. Fast enough (a couple of fuser kills with
// a short grace sleep) to await and report real output, unlike start.
export async function DELETE() {
  if (IS_REMOTE) return forward("DELETE", {});

  try {
    const { stdout, stderr } = await execFileAsync(ADDIE_BIN, ["stop"], { timeout: 30_000 });
    return NextResponse.json({ success: true, output: sanitizeScriptOutput(`${stdout}${stderr}`) });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const output = sanitizeScriptOutput([err.stdout, err.stderr].filter(Boolean).join("\n"));
    return NextResponse.json({ error: output || err.message || String(error) }, { status: 500 });
  }
}
