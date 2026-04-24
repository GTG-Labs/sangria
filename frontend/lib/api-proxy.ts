/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { JSONSecurity } from "./security";
import { env } from "./env";

/**
 * Proxy a request to the backend API with auth, timeout, and error handling.
 *
 * @param method - HTTP method (GET, POST, DELETE, etc.)
 * @param path - Backend path (e.g. "/api-keys" or "/api-keys/123")
 * @param options.body - Optional request body (will be JSON-stringified)
 * @param options.rawResponse - If true, return 204 with no body on success
 *                              instead of parsing JSON. Used for DELETE.
 * @param request - Incoming request. Required so the CSRF cookie can be
 *                  forwarded to the Go backend (its CSRFMiddleware requires
 *                  both the cookie AND the X-CSRF-Token header).
 */
export async function proxyToBackend(
  method: string,
  path: string,
  options: { body?: unknown; rawResponse?: boolean } | undefined,
  request: Request
): Promise<NextResponse> {
  try {
    const { user, accessToken } = await withAuth();

    if (!user || !accessToken) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      // Secure request body preparation
      let requestBody: string | undefined;
      if (options?.body !== undefined) {
        // Validate object structure before serialization
        const validation = JSONSecurity.validateObjectStructure(options.body);
        if (!validation.isValid) {
          console.error('Invalid object structure:', validation.error);
          clearTimeout(timeoutId); // Clean up timer on early return
          return NextResponse.json(
            { error: "Invalid request data structure" },
            { status: 400 }
          );
        }

        // Safe JSON serialization with prototype pollution protection
        requestBody = JSONSecurity.safeStringify(options.body);
      }

      // Get CSRF token from the incoming request's cookie jar. Server-side
      // only — there's no other source here (Node fetch has no document,
      // no global cookie jar).
      const csrfCookie = request.headers.get('cookie')
        ?.split(';')
        ?.find(cookie => cookie.trim().startsWith('csrf_token='));
      // Use slice(idx + 1) instead of split('=')[1] so a token containing
      // an '=' (base64url padding, future format) isn't truncated.
      const eqIdx = csrfCookie?.indexOf('=') ?? -1;
      const csrfToken = csrfCookie && eqIdx >= 0
        ? csrfCookie.slice(eqIdx + 1).trim()
        : null;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      // Add CSRF token to headers for state-changing operations.
      // Also set a Cookie header — backend CSRFMiddleware does double-submit
      // (cookie + X-CSRF-Token) and Node's server-side fetch does not inherit
      // browser cookies on outbound requests.
      if (method !== "GET" && csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
        headers["Cookie"] = `csrf_token=${csrfToken}`;
      }

      const response = await fetch(`${env.BACKEND_URL}${path}`, {
        method,
        headers,
        ...(requestBody && { body: requestBody }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        try {
          const data = await response.json();
          return NextResponse.json(data, { status: response.status });
        } catch {
          return NextResponse.json(
            { error: `Backend error: ${response.statusText}` },
            { status: response.status }
          );
        }
      }

      if (options?.rawResponse) {
        return new NextResponse(null, { status: response.status });
      }

      const text = await response.text();
      if (!text) {
        return new NextResponse(null, { status: response.status });
      }
      const data = JSON.parse(text);
      return NextResponse.json(data, { status: response.status });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      if (fetchError.name === "AbortError" || controller.signal.aborted) {
        return NextResponse.json(
          { error: "Gateway timeout - backend request took too long" },
          { status: 504 }
        );
      }

      throw fetchError;
    }
  } catch (error) {
    console.error(`API proxy ${method} ${path} error:`, error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
