// Scratchpad: the ephemeral notepad opened from the file-bookmarks menu.
// Lives in /tmp so it is wiped on reboot — the point. PI_WEB_SCRATCHPAD_PATH
// overrides the location.
export function getScratchpadPath(): string {
  return process.env.PI_WEB_SCRATCHPAD_PATH ?? "/tmp/scratchpad.md";
}
