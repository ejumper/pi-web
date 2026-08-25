import { getRunningRpcSessionIds, subscribeRunningSessions } from "@/lib/rpc-manager";
import { getLiveSessionIds } from "@/lib/live-bridge";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const unsubscribe = subscribeRunningSessions((ids) => {
        try {
          encode({ type: "running", runningSessionIds: ids, liveSessionIds: getLiveSessionIds() });
        } catch {
          // controller already closed
        }
      });

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      let lastLiveJson = "";
      const initialLive = getLiveSessionIds();
      lastLiveJson = JSON.stringify(initialLive);
      encode({
        type: "running",
        runningSessionIds: getRunningRpcSessionIds(),
        liveSessionIds: initialLive,
      });

      // Terminal sessions become live/unlive without any in-process event, so
      // watch the registry for deltas and push when it changes.
      const liveWatcher = setInterval(() => {
        try {
          const live = getLiveSessionIds();
          const json = JSON.stringify(live);
          if (json !== lastLiveJson) {
            lastLiveJson = json;
            encode({ type: "running", runningSessionIds: getRunningRpcSessionIds(), liveSessionIds: live });
          }
        } catch {
          // controller already closed
        }
      }, 3_000);

      // Heartbeat to keep the connection alive through proxies/timeouts.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        clearInterval(liveWatcher);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
