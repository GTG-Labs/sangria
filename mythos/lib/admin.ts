import { env } from "@/lib/env";

/**
 * Check if the authenticated user is an admin by calling the backend.
 * Returns true if the user is in the admins table, false otherwise.
 */
export async function verifyAdmin(accessToken: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${env.BACKEND_URL}/admin/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}
