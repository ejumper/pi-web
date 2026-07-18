// Which sessions currently have the voicemail-notify toggle on. In-memory
// only, on globalThis to survive Next.js dev hot-reload — an ephemeral
// "for right now" setting (per the UI: a top-bar toggle, not a persisted
// preference), same reasoning as the speak caches in lib/speak.ts.
declare global {
  var __piNotifyEnabledSessions: Set<string> | undefined;
}

function notifySet(): Set<string> {
  if (!globalThis.__piNotifyEnabledSessions) globalThis.__piNotifyEnabledSessions = new Set();
  return globalThis.__piNotifyEnabledSessions;
}

export function isNotifyEnabled(sessionId: string): boolean {
  return notifySet().has(sessionId);
}

export function setNotifyEnabled(sessionId: string, enabled: boolean): void {
  if (enabled) notifySet().add(sessionId);
  else notifySet().delete(sessionId);
}
