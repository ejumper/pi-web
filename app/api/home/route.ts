import { NextResponse } from "next/server";
import { homedir } from "os";
import { join } from "path";

// JUMPERPEDIA_HOME overrides the default "~/HalfaCloud/Jumperpedia" location —
// set this per-deployment (e.g. a container where Jumperpedia is bind-mounted
// somewhere else) instead of editing the pinned-projects list directly, so it
// survives a fresh clone/pull instead of being clobbered by it.
export async function GET() {
  const home = homedir();
  const jumperpediaHome = process.env.JUMPERPEDIA_HOME || join(home, "HalfaCloud", "Jumperpedia");
  return NextResponse.json({ home, jumperpediaHome });
}
