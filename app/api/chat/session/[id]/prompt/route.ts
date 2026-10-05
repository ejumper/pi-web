import { NextResponse } from "next/server";
import { applyChatModel, ensureChatSession } from "@/lib/chat-runtime";
import { resolveSessionPath } from "@/lib/session-reader";

export const runtime = "nodejs";

// POST /api/chat/session/[id]/prompt — send a prompt into an existing chat
// session. The addie/default-cloud model check runs only when the session's
// agent had to be (re)started — a manual model pick from the Models popup
// survives until the session is reloaded.
// Body: { message: string, images?: Array<{ type: "image"; data: string; mimeType: string }> }

interface PromptBody {
  message?: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as PromptBody;
    const message = (body.message ?? "").trim();
    const images = body.images?.length ? body.images : undefined;
    if (!message && !images) {
      return NextResponse.json({ error: "message or images required" }, { status: 400 });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    const { session, fresh } = await ensureChatSession(id, filePath);
    const model = fresh ? await applyChatModel(session) : null;
    await session.send({ type: "prompt", message, images });
    return NextResponse.json({ success: true, ...(model ? { model } : {}) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
