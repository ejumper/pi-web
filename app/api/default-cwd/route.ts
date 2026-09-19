import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { resolveDefaultWorkspace } from "@/lib/default-workspace";

// POST /api/default-cwd
// Creates the default workspace directory if it doesn't exist and returns the path.
// See JUMPERPEDIA_HOME / PI_WEB_DEFAULT_WORKSPACE notes in lib/default-workspace.ts.
export async function POST() {
  try {
    const dir = resolveDefaultWorkspace();
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
