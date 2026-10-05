import { NextResponse } from "next/server";
import { chatWorkspace } from "@/lib/chat-runtime";
import { listAllSessions } from "@/lib/session-reader";

export const runtime = "nodejs";

// GET /api/chat/sessions — past voice-chat sessions (everything in the sonar
// workspace, shared with pi-web's default workspace), oldest first so the UI
// can show them chronological with the most recent at the bottom.

export async function GET() {
  try {
    const cwd = chatWorkspace();
    const all = await listAllSessions();
    const sessions = all
      .filter((s) => s.cwd === cwd)
      .sort((a, b) => a.modified.localeCompare(b.modified))
      .map((s) => ({
        id: s.id,
        name: s.name || s.firstMessage || "(no messages)",
        modified: s.modified,
      }));
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
