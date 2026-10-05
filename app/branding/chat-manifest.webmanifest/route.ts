export const runtime = "nodejs";

// PWA manifest for the /chat voice page (same icon on every deployment).

export async function GET() {
  return new Response(
    JSON.stringify({
      name: "Pi Voice Chat",
      short_name: "Voice Chat",
      start_url: "/chat",
      display: "standalone",
      background_color: "#000000",
      theme_color: "#000000",
      icons: [
        { src: "/chat/icon.png", sizes: "278x277", type: "image/png", purpose: "any" },
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
