import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

// Same PI_WEB_PUBLIC_URL used by lib/ntfy.ts — derive just the hostname
// rather than duplicating it as a second env var.
const publicHostname = process.env.PI_WEB_PUBLIC_URL ? new URL(process.env.PI_WEB_PUBLIC_URL).host : undefined;

const nextConfig: NextConfig = {
  // dev server writes to its own dist dir (PI_WEB_DEV_DIST=.next-dev) so
  // `next dev` iteration can run alongside the production `next start`
  // without clobbering .next
  distDir: process.env.PI_WEB_DEV_DIST || ".next",
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: publicHostname ? ['192.168.*.*', publicHostname] : ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
