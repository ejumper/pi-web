import { NextResponse } from "next/server";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { getNotepadPath, type NotepadKind } from "@/lib/notepad";

// POST /api/notepad/open  body: { kind: "tmpnote" | "quicknote" }
//
// Ensures the notepad file exists (creating its parent directory too if
// needed), adds the parent to the file-access allow-list so /api/files can
// serve it, and returns the resolved path. The client opens the file directly
// in the editor — the session cwd and the explorer's shown directory are
// deliberately untouched, which is the whole point of the notepad.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { kind?: unknown };
    const kind = body.kind;
    if (kind !== "tmpnote" && kind !== "quicknote") {
      return NextResponse.json({ error: "kind must be 'tmpnote' or 'quicknote'" }, { status: 400 });
    }

    const notepadPath = getNotepadPath(kind as NotepadKind);
    const parent = dirname(notepadPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    if (!existsSync(notepadPath)) writeFileSync(notepadPath, "", "utf8");
    allowFileRoot(parent);

    return NextResponse.json({ success: true, path: notepadPath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
