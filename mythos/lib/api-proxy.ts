/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";

const BACKEND_URL = process.env.BACKEND_URL;

if (!BACKEND_URL) {
  throw new Error("BACKEND_URL is not configured");
}

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
      const target = new URL(path, BACKEND_URL);
      if (target.origin !== new URL(BACKEND_URL).origin) {
        return NextResponse.json(
          { error: "Invalid proxy target" },
          { status: 400 }
        );
      }

      const response = await fetch(target, {
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
        return new NextResponse(response.body, {
          status: response.status,
          headers: response.headers,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
      }

      const text = await response.text();
      if (!text) {
        return new NextResponse(null, { status: response.status });
      }
      return new NextResponse(text, { status: response.status });
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
