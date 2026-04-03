import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

/**
 * Proxy a request to the backend API with auth, timeout, and error handling.
 *
 * @param method - HTTP method (GET, POST, DELETE, etc.)
 * @param path - Backend path (e.g. "/api-keys" or "/api-keys/123")
 * @param options.body - Optional request body (will be JSON-stringified)
 * @param options.rawResponse - If true, return 204 with no body on success
 *                              instead of parsing JSON. Used for DELETE.
 */
export async function proxyToBackend(
  method: string,
  path: string,
  options?: { body?: unknown; rawResponse?: boolean }
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
      const response = await fetch(`${BACKEND_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        ...(options?.body !== undefined && {
          body: JSON.stringify(options.body),
        }),
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
