import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { getScratchpadPath } from "@/lib/notepad";

// POST /api/notepad/open
//
// Ensures the scratchpad file exists (creating its parent directory too if
// needed), adds the parent to the file-access allow-list so /api/files can
// serve it, and returns the resolved path. The client opens the file directly
// in the editor — the session cwd and the explorer's shown directory are
// deliberately untouched, which is the whole point of the scratchpad.
// The file lives in /tmp, so a reboot wipes it; the next open recreates it.
export async function POST() {
  try {
    const scratchpadPath = getScratchpadPath();
    const parent = dirname(scratchpadPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    if (!existsSync(scratchpadPath)) writeFileSync(scratchpadPath, "", "utf8");
    allowFileRoot(parent);

    return NextResponse.json({ success: true, path: scratchpadPath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
