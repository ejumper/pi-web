import { NextResponse } from "next/server";
import { statSync, type Stats } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";

function normalizePath(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

// POST /api/browse/allow  body: { path: string }
//
// Makes one more directory listable in the file explorer without touching any
// session's cwd. This is the same `allowFileRoot()` step that
// /api/cwd/validate performs when the user picks a workspace — split out here
// so the explorer's "up one directory" button can widen its own view without
// implying a session-cwd change.
//
// Deliberate widening of the explorer allow-list (see filesystem-cwd.md): the
// list was never a security boundary on the agent (its Bash tool runs as the
// normal user regardless), only a guard on what the browser panel can wander
// into. The same widening is already reachable via /api/cwd/validate.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { path?: unknown };
    const raw = typeof body.path === "string" ? body.path.trim() : "";

    if (!raw) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const normalizedPath = normalizePath(raw);
    let stat: Stats;
    try {
      stat = statSync(normalizedPath);
    } catch {
      return NextResponse.json({ error: `Directory does not exist: ${raw}` }, { status: 400 });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `Path is not a directory: ${raw}` }, { status: 400 });
    }

    allowFileRoot(normalizedPath);
    return NextResponse.json({ success: true, path: normalizedPath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
