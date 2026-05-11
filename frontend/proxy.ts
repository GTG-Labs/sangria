import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextResponse } from 'next/server';
import type { NextRequest, NextFetchEvent } from 'next/server';
import crypto from 'crypto';
import { env } from '@/lib/env';

// Enhanced middleware that adds CSP nonce to authkit middleware
const authMiddleware = authkitMiddleware({
  redirectUri: env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
});

// Headers.forEach() in undici joins multiple Set-Cookie values into one
// comma-separated string, breaking downstream cookie parsing. Extract them
// individually via getSetCookie() and append each one preserved.
function copyHeaders(src: Headers, dst: Headers) {
  const setCookies =
    typeof (src as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (src as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const cookie of setCookies) {
    dst.append('set-cookie', cookie);
  }
  src.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'set-cookie' || lower === 'content-security-policy') return;
    dst.set(key, value);
  });
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Generate a random nonce for this request
  const nonce = crypto.randomBytes(16).toString('base64');
  // Create Content Security Policy with nonce and strict-dynamic
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://workoscdn.com;
    style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com;
    img-src 'self' blob: data: https://workoscdn.com;
    font-src 'self' https://fonts.gstatic.com;
    connect-src 'self' https://api.workos.com https://api.github.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim();
  // Forward nonce into request headers for server components
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Also set CSP on the request so Next.js's SSR layer can read the nonce
  // and inject it into framework-generated scripts/styles.
  requestHeaders.set('content-security-policy', cspHeader);
  // Call the authkit middleware first
  const authResponse = await authMiddleware(request, event);
  // Create response based on auth result
  let response: NextResponse;
  if (authResponse instanceof NextResponse) {
    // Preserve authkit's response (redirects/cookies) but still forward nonce
    // into downstream request headers via a fresh NextResponse when possible.
    response = authResponse;
    // If the auth response is a pass-through (no redirect/rewrite), re-issue
    // it so the x-nonce propagates to server components.
    if (!authResponse.headers.get('location')) {
      const passthrough = NextResponse.next({ request: { headers: requestHeaders } });
      copyHeaders(authResponse.headers, passthrough.headers);
      response = passthrough;
    }
  } else if (authResponse instanceof Response) {
    // Convert Response to NextResponse
    response = NextResponse.next({ request: { headers: requestHeaders } });
    copyHeaders(authResponse.headers, response.headers);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  // Add CSP and nonce headers
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
