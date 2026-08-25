import { NextResponse } from "next/server";
import { getLiveEntryFresh } from "@/lib/live-bridge";
import { checkBridge } from "@/lib/live-fanout";

export const dynamic = "force-dynamic";

// POST /api/live/[id]/abort — abort the terminal session's active run.
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

	const upstream = await fetch(`http://127.0.0.1:${entry.port}/abort`, {
		method: "POST",
		signal: AbortSignal.timeout(15_000),
	});
	const data = await upstream.json().catch(() => ({}));
	return NextResponse.json(data, { status: upstream.status });
}
