import { brandSuffix } from "../brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PWA manifest for pi-web itself (Android install + general web-app metadata).
// Brand-aware so home-screen installs read correctly on both deployments.

const BRANDS = {
  server: { name: "Pi Web", short_name: "Pi" },
  desktop: { name: "Pi Web Desktop", short_name: "Pi" },
} as const;

export async function GET() {
  const brand = BRANDS[brandSuffix()];
  return new Response(
    JSON.stringify({
      name: brand.name,
      short_name: brand.short_name,
      start_url: "/",
      display: "standalone",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [
        { src: "/branding/icon.png", sizes: "278x277", type: "image/png", purpose: "any" },
      ],
    }),
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=86400",
      },
    },
  );
}
