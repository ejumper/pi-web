import { NextResponse } from "next/server";
import { homedir } from "os";
import { join } from "path";
import { defaultWorkspaceOnLoad, resolveDefaultWorkspace } from "@/lib/default-workspace";

// JUMPERPEDIA_HOME overrides the default "~/HalfaCloud/Jumperpedia" location —
// set this per-deployment (e.g. a container where Jumperpedia is bind-mounted
// somewhere else) instead of editing the pinned-projects list directly, so it
// survives a fresh clone/pull instead of being clobbered by it.
//
// defaultWorkspace / defaultOnLoad are exposed here (rather than read from
// process.env in the client) because Next only inlines NEXT_PUBLIC_* vars into
// client bundles — see lib/default-workspace.ts for the source of truth.
export async function GET() {
  const home = homedir();
  const jumperpediaHome = process.env.JUMPERPEDIA_HOME || join(home, "HalfaCloud", "Jumperpedia");
  return NextResponse.json({
    home,
    jumperpediaHome,
    defaultWorkspace: resolveDefaultWorkspace(),
    defaultOnLoad: defaultWorkspaceOnLoad(),
  });
}
