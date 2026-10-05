import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Agent Web",
  description: "Pi Coding Agent Web Interface",
  // Brand icons are served per deployment from /branding/* (PI_WEB_BRAND
  // selects server vs desktop art) — favicon, apple-touch-icon and the PWA
  // manifest all resolve there.
  icons: {
    icon: [{ url: "/branding/icon.png", type: "image/png", sizes: "278x277" }],
    apple: [{ url: "/branding/apple-icon.png", type: "image/png", sizes: "278x277" }],
  },
  manifest: "/branding/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Pi Web", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Disables the iOS PWA auto-zoom-on-input-focus behavior.
  maximumScale: 1,
  userScalable: false,
  // Lets the page draw into the safe area (notch/home-indicator/rounded
  // corners) so `env(safe-area-inset-*)` resolves to real values instead of 0.
  viewportFit: "cover",
  // Android Chrome: shrink the *layout* viewport when the keyboard opens so
  // flex/100vh containers resize and the composer sits above the keyboard
  // instead of being covered. iOS ignores this (never implemented).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ display: "flex", flexDirection: "column" }}>
        {/* iOS WebKit "first tap fires no click" guard. Safari can get into a
            state where taps stop producing click events page-wide until
            reload — triggered by touchstart/touchmove listeners being added
            and removed as the app runs. A single touchstart listener that is
            registered before anything else and never removed keeps click
            delivery healthy. It's passive and empty on purpose: it must exist,
            not do anything. See docs/bug-list notes / SO 41972388. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.addEventListener("touchstart",function(){},{passive:true})}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
