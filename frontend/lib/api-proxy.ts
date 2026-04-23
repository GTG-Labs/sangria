/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { JSONSecurity } from "./security";
// Server-safe CSRF token retrieval
function getCSRFToken(): string | null {
  if (typeof document !== 'undefined') {
    // Try cookie first (matches backend)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf_token') {
        return value;
      }
    }

    // Fallback to sessionStorage if available
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem('csrf_token');
    }
  }
  return null;
}

const BACKEND_URL = process.env.BACKEND_URL;

/**
 * Proxy a request to the backend API with auth, timeout, and error handling.
 *
 * @param method - HTTP method (GET, POST, DELETE, etc.)
 * @param path - Backend path (e.g. "/api-keys" or "/api-keys/123")
 * @param options.body - Optional request body (will be JSON-stringified)
 * @param options.rawResponse - If true, return 204 with no body on success
 *                              instead of parsing JSON. Used for DELETE.
 * @param request - NextRequest object to read cookies from
 */
export async function proxyToBackend(
  method: string,
  path: string,
  options?: { body?: unknown; rawResponse?: boolean },
  request?: Request
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
          return NextResponse.json(
            { error: "Invalid request data structure" },
            { status: 400 }
          );
        }

        // Safe JSON serialization with prototype pollution protection
        requestBody = JSONSecurity.safeStringify(options.body);
      }

      // Get CSRF token for state-changing requests
      let csrfToken: string | null = null;
      if (request) {
        csrfToken = request.headers.get('cookie')
          ?.split(';')
          ?.find(cookie => cookie.trim().startsWith('csrf_token='))
          ?.split('=')[1] || null;
      } else {
        csrfToken = getCSRFToken();
      }
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      // Add CSRF token to headers for state-changing operations
      if (method !== "GET" && csrfToken) {
        headers["X-CSRF-Token"] = csrfToken;
      }

      const response = await fetch(`${BACKEND_URL}${path}`, {
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
