import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const runtime = "nodejs";

/**
 * Root for the right-panel file browser. Desktop defaults to ~; the server
 * container sets PI_WEB_FILES_ROOT=/home/node/Jumperpedia in docker-compose
 * (= ~/Jumperpedia) so the browser stays inside Jumperpedia there.
 */
function getRoot(): string {
  const raw = process.env.PI_WEB_FILES_ROOT?.trim();
  const withHome = raw ? raw.replace(/^~(?=\/|$)/, os.homedir()) : os.homedir();
  return path.resolve(withHome);
}

/** Resolve a client-supplied path strictly inside the root (no .. escapes). */
function jail(root: string, p: string): string | null {
  const abs = path.resolve(root, p || ".");
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

export async function GET(req: NextRequest) {
  const root = getRoot();
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  const abs = jail(root, rel);
  if (!abs) return NextResponse.json({ error: "path outside root" }, { status: 403 });
  try {
    const dirents = await fs.readdir(abs, { withFileTypes: true });
    const entries = dirents
      .map((d) => ({ name: d.name, path: path.join(abs, d.name), isDir: d.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDir ? -1 : 1));
    return NextResponse.json({ root, entries });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
