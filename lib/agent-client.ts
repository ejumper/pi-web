// Client-side helper for POST /api/agent/[id].
//
// Every /api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || body.error) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

// Client-side helper for the /api/live/[id]/* control surface (send/abort/
// commands) used by terminal-live sessions. Mirrors sendAgentCommand's
// response conventions.
export async function sendLiveCommand<T = unknown>(
  sessionId: string,
  path: "send" | "abort" | "commands",
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`/api/live/${encodeURIComponent(sessionId)}/${path}`, {
    method: path === "commands" ? "GET" : "POST",
    headers: path === "commands" ? undefined : { "Content-Type": "application/json" },
    body: path === "commands" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || data?.error) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return data;
}
