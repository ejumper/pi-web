import { readFile } from "fs/promises";
import { join } from "path";
import { brandIconFile } from "../brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// iOS home-screen ("apple web app") icon — same brand art as the favicon.

export async function GET() {
  const bytes = await readFile(join(process.cwd(), "public", "branding-src", brandIconFile()));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
