import { NextResponse } from "next/server";
import { applyChatModel, ensureChatSession } from "@/lib/chat-runtime";

export const runtime = "nodejs";

// POST /api/chat/session — create a new voice-chat session in the sonar
// workspace and send its first prompt (model auto-pick included, unless a
// manual `model` pick from the Models popup is supplied).
// Body: { message: string, images?: Array<...>, model?: { provider, modelId } }
// Returns { sessionId }.

interface PromptBody {
  message?: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  model?: { provider: string; modelId: string };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PromptBody;
    const message = (body.message ?? "").trim();
    const images = body.images?.length ? body.images : undefined;
    if (!message && !images) {
      return NextResponse.json({ error: "message or images required" }, { status: 400 });
    }

    const { session, sessionId } = await ensureChatSession(null, "");
    if (body.model?.provider && body.model?.modelId) {
      await session.send({ type: "set_model", provider: body.model.provider, modelId: body.model.modelId });
    } else {
      await applyChatModel(session);
    }
    await session.send({ type: "prompt", message, images });
    return NextResponse.json({ sessionId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
