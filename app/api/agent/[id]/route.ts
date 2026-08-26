import { NextResponse } from "next/server";
import { resolveSessionPath, invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { isLive, getLiveEntryFresh } from "@/lib/live-bridge";
import { resolveRelocatedSession } from "@/lib/live-resolve";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    let filePath = await resolveSessionPath(id);
    if (!filePath) {
      // Brand-new terminal sessions are invisible to the 30s list cache; the
      // spawn-guard must still recognize them (409), never 404 a session that
      // is registered live. Registry-hinted local resolve first (fast, covers
      // relocations too); full rescan only as last resort for non-live ids.
      const hintPath = getLiveEntryFresh(id)?.sessionFile;
      if (hintPath) filePath = resolveRelocatedSession(hintPath, id);
      if (!filePath && !isLive(id)) {
        invalidateSessionListCache();
        filePath = await resolveSessionPath(id);
      }
    }
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Live in a terminal? Commands must not fork a second agent onto the file.
    if (isLive(id)) {
      return NextResponse.json(
        { error: "Session is live in a terminal — read-only until Phase 3", live: true },
        { status: 409 }
      );
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
