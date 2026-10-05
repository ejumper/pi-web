import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Pi Voice Chat",
  description: "Hands-free voice chat with pi",
  // /chat keeps its own favicon + iOS home-screen icon (pwa-icon.png) so it
  // is visually distinct from pi-web in tabs and on the home screen.
  icons: {
    icon: [{ url: "/chat/icon.png", type: "image/png", sizes: "256x256" }],
    apple: [{ url: "/chat/apple-icon.png", type: "image/png", sizes: "256x256" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
