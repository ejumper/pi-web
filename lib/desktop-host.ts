// Host for the desktop's local services (TTS, STT, llama-server) — defaults
// to loopback for the normal case (pi-web running on the same desktop as
// those services, which already bind 0.0.0.0). Set DESKTOP_HOST to the
// desktop's LAN IP when pi-web runs elsewhere on the same network (e.g. the
// containerized instance on the server) so it can reach them whenever the
// desktop happens to be on; fetches already fail soft (timeout + "not
// running" response) if it isn't. See pi-audio.md.
export const DESKTOP_HOST = process.env.DESKTOP_HOST || "127.0.0.1";
