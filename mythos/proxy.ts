import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";
import crypto from "crypto";
import { env } from "@/lib/env";

// Wrap authkit's middleware so we can layer a per-request nonce-based CSP on
// top of its auth flow. Mirrors frontend/proxy.ts but with a narrower
// allowlist — mythos loads no external fonts/images/scripts.
const authMiddleware = authkitMiddleware({
  redirectUri: env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [],
  },
});

// Headers.forEach() in undici joins multiple Set-Cookie values into one
// comma-separated string, breaking downstream cookie parsing. Extract them
// individually via getSetCookie() and append each one preserved.
function copyHeaders(src: Headers, dst: Headers) {
  const setCookies =
    typeof (src as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (src as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const cookie of setCookies) {
    dst.append("set-cookie", cookie);
  }
  src.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie" || lower === "content-security-policy") return;
    dst.set(key, value);
  });
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const nonce = crypto.randomBytes(16).toString("base64");
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' blob: data:;
    font-src 'self';
    connect-src 'self' https://api.workos.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, " ")
    .trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Also set CSP on the request so Next.js's SSR layer can read the nonce
  // and inject it into framework-generated scripts/styles.
  requestHeaders.set("content-security-policy", cspHeader);

  const authResponse = await authMiddleware(request, event);

  let response: NextResponse;
  if (authResponse instanceof NextResponse) {
    response = authResponse;
    // If authkit returned a pass-through (no redirect/rewrite), re-issue so
    // the x-nonce propagates to server components.
    if (!authResponse.headers.get("location")) {
      const passthrough = NextResponse.next({ request: { headers: requestHeaders } });
      copyHeaders(authResponse.headers, passthrough.headers);
      response = passthrough;
    }
  } else if (authResponse instanceof Response) {
    response = NextResponse.next({ request: { headers: requestHeaders } });
    copyHeaders(authResponse.headers, response.headers);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("x-nonce", nonce);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
