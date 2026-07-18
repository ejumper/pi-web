import { getLastAssistantEntryId, getOrGenerateFullAudio } from "./speak";

const NTFY_URL = "https://notify.halfab.net";
const NTFY_TOPIC = "pi_desktop";
// This machine's Tailscale HTTPS hostname (see pi-web.md) — the phone
// fetches audio through this, not localhost, since the Shortcut that plays
// it runs on the phone, not on this machine.
const PI_WEB_PUBLIC_URL = "https://kubuntu.taildf74fb.ts.net";
// Must exactly match the name of the Shortcut created in the iOS Shortcuts
// app (two actions: Get Contents of URL [Shortcut Input] -> Play Sound).
const SHORTCUT_NAME = "PlayReply";

/**
 * Voicemail notify: generates the full reply audio (blocking — the
 * notification isn't sent until it's ready, per the "notification arrives
 * with the audio already done" requirement) and pushes an ntfy notification
 * whose tap runs an iOS Shortcut that fetches and plays it, without ever
 * opening a browser tab or switching away from whatever app is in front.
 *
 * Deliberately fire-and-forget from the caller's side (rpc-manager's
 * agent_end handler doesn't await this) and deliberately swallows its own
 * errors — a failed voicemail push should never affect the actual agent
 * session.
 */
export async function sendVoicemailNotification(sessionId: string): Promise<void> {
  try {
    const entryId = await getLastAssistantEntryId(sessionId);
    if (!entryId) return;

    const audio = await getOrGenerateFullAudio(sessionId, entryId);
    if (!audio) return;

    const audioUrl = `${PI_WEB_PUBLIC_URL}/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/speak/full`;
    const clickUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(audioUrl)}`;

    // Notification body is deliberately generic — the actual reply content
    // never has to pass through ntfy/APNs, only the click fetches it, over
    // Tailscale, when tapped.
    await fetch(`${NTFY_URL}/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: "POST",
      headers: {
        "Title": "Pi",
        "Click": clickUrl,
      },
      body: "Pi replied",
    });
  } catch (error) {
    console.error("[pi-web] voicemail notify failed:", error);
  }
}
