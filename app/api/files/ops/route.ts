import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const runtime = "nodejs";

/** Same root + jail as /api/files/list (PI_WEB_FILES_ROOT, default ~). */
function getRoot(): string {
  const raw = process.env.PI_WEB_FILES_ROOT?.trim();
  const withHome = raw ? raw.replace(/^~(?=\/|$)/, os.homedir()) : os.homedir();
  return path.resolve(withHome);
}

function jail(root: string, p: string): string | null {
  const abs = path.resolve(root, p || ".");
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

/** File/dir names may not contain separators or dot-walk. */
function validName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name !== "." && name !== ".."
    && !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

/**
 * File-explorer operations, all path-jailed to PI_WEB_FILES_ROOT:
 *   create  { path }            — new empty file (fails if it exists)
 *   mkdir   { path }            — new directory (fails if it exists)
 *   rename  { from, newName }   — rename within the same parent
 *   delete  { path }            — remove file or directory (recursive)
 *   copy    { from, toDir }     — copy/move-less paste (recursive for dirs)
 */
export async function POST(req: NextRequest) {
  const root = getRoot();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const action = body.action;

  try {
    if (action === "create" || action === "mkdir") {
      const abs = jail(root, String(body.path ?? ""));
      if (!abs) return NextResponse.json({ error: "path outside root" }, { status: 403 });
      if (!validName(path.basename(abs))) return NextResponse.json({ error: "invalid name" }, { status: 400 });
      if (action === "create") {
        const fh = await fs.open(abs, "wx");
        await fh.close();
      } else {
        await fs.mkdir(abs);
      }
      return NextResponse.json({ ok: true, path: abs });
    }

    if (action === "rename") {
      const from = jail(root, String(body.from ?? ""));
      if (!from) return NextResponse.json({ error: "path outside root" }, { status: 403 });
      const newName = body.newName;
      if (!validName(newName)) return NextResponse.json({ error: "invalid name" }, { status: 400 });
      const to = path.join(path.dirname(from), newName);
      const jailedTo = jail(root, to);
      if (!jailedTo) return NextResponse.json({ error: "path outside root" }, { status: 403 });
      await fs.rename(from, jailedTo);
      return NextResponse.json({ ok: true, path: jailedTo });
    }

    if (action === "delete") {
      const abs = jail(root, String(body.path ?? ""));
      if (!abs) return NextResponse.json({ error: "path outside root" }, { status: 403 });
      await fs.rm(abs, { recursive: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "copy") {
      const from = jail(root, String(body.from ?? ""));
      const toDir = jail(root, String(body.toDir ?? ""));
      if (!from || !toDir) return NextResponse.json({ error: "path outside root" }, { status: 403 });
      await fs.access(from); // a stale clipboard should no-op -> 404
      const to = path.join(toDir, path.basename(from));
      if (to === from) return NextResponse.json({ ok: true }); // paste in place
      await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false });
      return NextResponse.json({ ok: true, path: to });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (err.code === "EEXIST") return NextResponse.json({ error: "already exists" }, { status: 409 });
    return NextResponse.json({ error: err.message ?? String(e) }, { status: 500 });
  }
}
