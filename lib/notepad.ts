import { homedir } from "os";
import { join } from "path";

// Notepad files for quick ephemeral notes, opened from the top bar without
// touching the session's cwd or the explorer's shown directory.
//
// Jumperpedia's location is resolved the same way lib/default-workspace.ts
// does it: JUMPERPEDIA_HOME env (set on the server container) wins, else the
// desktop's Proton-Drive path. PI_WEB_JUMPERPEDIA overrides everything.
export function getJumperpediaHome(): string {
  if (process.env.PI_WEB_JUMPERPEDIA) return process.env.PI_WEB_JUMPERPEDIA;
  return process.env.JUMPERPEDIA_HOME || join(homedir(), "HalfaCloud", "Jumperpedia");
}

export type NotepadKind = "tmpnote" | "quicknote";

export function getNotepadPath(kind: NotepadKind): string {
  if (kind === "tmpnote") {
    return process.env.PI_WEB_TMPNOTE_PATH ?? "/tmp/notepad.md";
  }
  return process.env.PI_WEB_QUICKNOTE_PATH ?? join(getJumperpediaHome(), "Quicknotes", "notepad.md");
}
