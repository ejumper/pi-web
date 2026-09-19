import { randomUUID } from "crypto";
import { writeFile } from "fs/promises";
import { NextResponse } from "next/server";

// POST /api/attachments  body: multipart/form-data { file: File }
// Generic file attachments: writes the upload to /tmp as
// /tmp/pi-clipboard-<uuid>.<ext> (same convention the pi TUI uses for
// pasted images) and returns the path. The chat composer references it
// in the user message as `@<path>` so the agent can read it with its
// own tools. Files are intentionally left for container restarts to
// clean up — no TTL sweep.
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const ATTACHMENT_DIR = "/tmp";

function sanitizeExt(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
  return /^[A-Za-z0-9]{1,12}$/.test(ext) ? ext.toLowerCase() : "bin";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file field is required" }, { status: 400 });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)` },
        { status: 413 },
      );
    }

    // Server-generated name: uuid + sanitized extension only, so the
    // client-controlled filename can never influence the path.
    const dest = `${ATTACHMENT_DIR}/pi-clipboard-${randomUUID()}.${sanitizeExt(file.name)}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(dest, bytes);

    return NextResponse.json({ path: dest, name: file.name, size: file.size });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
