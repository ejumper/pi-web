import { NextResponse, type NextRequest } from "next/server";

// The API is cookie/auth-free, so a wildcard origin is safe — no credentials
// support needed. Headers for cross-origin clients (e.g. Obsidian plugin
// webviews at app://obsidian.md / capacitor://localhost) calling /api/*.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function proxy(request: NextRequest): NextResponse {
  // Preflight: short-circuit, no need to hit the route handler.
  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // Pass through and attach the headers so the actual responses carry them too.
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
