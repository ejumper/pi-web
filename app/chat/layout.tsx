import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Pi Voice Chat",
  description: "Hands-free voice chat with pi",
  // /chat keeps its own favicon + home-screen icon + manifest (pi-sonar-chat)
  // so it is visually distinct from pi-web in tabs and on home screens.
  icons: {
    icon: [{ url: "/chat/icon.png", type: "image/png", sizes: "278x278" }],
    apple: [{ url: "/chat/apple-icon.png", type: "image/png", sizes: "278x278" }],
  },
  manifest: "/branding/chat-manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pi Voice Chat", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* iOS Safari ignores user-scalable=no — block pinch zoom at the event
          level (double-tap zoom is already off via touch-action). Runs before
          the page markup, same trick as the root layout's tap guard. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{
            var block=function(e){e.preventDefault();};
            ["gesturestart","gesturechange","gestureend"].forEach(function(t){document.addEventListener(t,block,{passive:false});});
            document.addEventListener("touchmove",function(e){if(e.touches.length>1)e.preventDefault();},{passive:false});
          }catch(e){}})();`,
        }}
      />
      {children}
    </>
  );
}
