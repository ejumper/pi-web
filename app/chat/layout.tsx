import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Pi Voice Chat",
  description: "Hands-free voice chat with pi",
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
