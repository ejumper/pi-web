import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import { getLiveSessionIds } from "@/lib/live-bridge";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({
      sessions,
      runningSessionIds: getRunningRpcSessionIds(),
      liveSessionIds: getLiveSessionIds(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
