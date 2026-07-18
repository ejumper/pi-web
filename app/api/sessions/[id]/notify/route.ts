import { NextResponse } from "next/server";
import { isNotifyEnabled, setNotifyEnabled } from "@/lib/notify-state";

// GET /api/sessions/[id]/notify — current voicemail-notify toggle state.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json({ enabled: isNotifyEnabled(id) });
}

// POST /api/sessions/[id]/notify  body: { enabled: boolean }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    setNotifyEnabled(id, body.enabled);
    return NextResponse.json({ success: true, enabled: body.enabled });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
