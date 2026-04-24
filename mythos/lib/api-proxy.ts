/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { verifyAdmin } from "@/lib/admin";
import { env } from "@/lib/env";

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

    // Defense-in-depth: every mythos backend call is an admin operation.
    // Verify admin status at the proxy layer in addition to the layout-level
    // gate and backend's RequireAdmin middleware — if either regresses,
    // non-admin authenticated users still can't reach admin endpoints.
    const isAdmin = await verifyAdmin(accessToken);
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const target = new URL(path, env.BACKEND_URL);
      if (target.origin !== new URL(env.BACKEND_URL).origin) {
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
