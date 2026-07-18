import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { allowFileRoot } from "@/lib/file-access";

// POST /api/default-cwd
// Creates the default workspace directory if it doesn't exist and returns the path.
// See JUMPERPEDIA_HOME note in app/api/home/route.ts.
export async function POST() {
  try {
    const jumperpediaHome = process.env.JUMPERPEDIA_HOME || join(homedir(), "HalfaCloud", "Jumperpedia");
    const dir = join(jumperpediaHome, "Quicknotes");
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
