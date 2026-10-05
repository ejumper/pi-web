import { NextResponse } from "next/server";
import { applyChatModel, chatWorkspace, ensureChatSession } from "@/lib/chat-runtime";
import { listAllSessions, resolveSessionPath } from "@/lib/session-reader";

export const runtime = "nodejs";

// POST /api/chat/session/[id]/load — "re-open a session" for the voice page:
// attach the agent, re-run the addie/default-cloud model check (spec: every
// reload re-decides), and return the title + last assistant text for display.

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const { session } = await ensureChatSession(id, filePath);
    const model = await applyChatModel(session);

    let name = "";
    const cwd = chatWorkspace();
    const all = await listAllSessions();
    const info = all.find((s) => s.id === id && s.cwd === cwd);
    if (info) name = info.name || info.firstMessage || "";

    const last = (await session.send({ type: "get_last_assistant_text" })) as { text?: string } | null;
    return NextResponse.json({ sessionId: id, name, text: last?.text ?? "", model });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
