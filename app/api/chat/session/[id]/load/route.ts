import { NextResponse } from "next/server";
import { applyChatModel, chatWorkspace, ensureChatSession } from "@/lib/chat-runtime";
import { listAllSessions, resolveSessionPath } from "@/lib/session-reader";

export const runtime = "nodejs";

// POST /api/chat/session/[id]/load — "re-open a session" for the voice page:
// attach the agent, pick the model (an explicit `model` in the body — the π
// button hand-off — beats the check; otherwise every reload re-runs the
// addie/default-cloud check per spec), and return the title + last assistant
// text for display.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { model?: { provider: string; modelId: string } };
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const { session } = await ensureChatSession(id, filePath);
    let model: { provider: string; modelId: string };
    if (body.model?.provider && body.model?.modelId) {
      await session.send({ type: "set_model", provider: body.model.provider, modelId: body.model.modelId });
      model = body.model;
    } else {
      model = await applyChatModel(session);
    }

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
