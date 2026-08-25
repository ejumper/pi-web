import { NextResponse } from "next/server";
import { getLiveEntryFresh } from "@/lib/live-bridge";
import { checkBridge } from "@/lib/live-fanout";

export const dynamic = "force-dynamic";

// POST /api/live/[id]/send — forward a prompt injection to the terminal
// session's pi-live bridge. Body: { text, deliverAs? }.
export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const entry = getLiveEntryFresh(id);
	if (!entry?.port || !(await checkBridge(entry))) {
		return NextResponse.json(
			{ error: "bridge offline; read-only view active", live: !!entry },
			{ status: 409 }
		);
	}

	let body = "";
	try {
		body = await req.text();
		JSON.parse(body); // validate before forwarding
	} catch {
		return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
	}

	const upstream = await fetch(`http://127.0.0.1:${entry.port}/send`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		signal: AbortSignal.timeout(30_000), // idle sends trigger an LLM turn; allow time
	});
	const data = await upstream.json().catch(() => ({}));
	return NextResponse.json(data, { status: upstream.status });
}
