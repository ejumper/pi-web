// Per-deployment brand selection shared by the /branding/* routes.
// PI_WEB_BRAND=desktop selects the desktop pi-web art (served at
// kubuntu.taildf74fb.ts.net); anything else gets the server art
// (ai.halfab.net). Both icon files ship in public/branding-src/ — the brand
// is the only thing that differs between the two deployments of one build.

export type Brand = "desktop" | "server";

export function brandSuffix(): Brand {
  return process.env.PI_WEB_BRAND === "desktop" ? "desktop" : "server";
}

export function brandIconFile(): string {
  return brandSuffix() === "desktop" ? "pi-sonar-desktop.png" : "pi-sonar.png";
}
