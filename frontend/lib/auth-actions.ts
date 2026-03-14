"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function handleSignOut() {
  try {
    // Clear all cookies on the server
    const cookieStore = await cookies();

    // List of known WorkOS cookie names to clear
    const workOSCookies = [
      "wos-session",
      "workos-access-token",
      "workos-session",
      "workos-refresh-token",
      "__Secure-workos-session",
      "__Host-workos-session",
    ];

    // Clear WorkOS cookies specifically
    workOSCookies.forEach((cookieName) => {
      cookieStore.set(cookieName, "", {
        expires: new Date(0),
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
    });

    // Also try to clear any other cookies
    const allCookies = cookieStore.getAll();
    allCookies.forEach((cookie) => {
      if (cookie.name.includes("workos") || cookie.name.includes("wos")) {
        cookieStore.set(cookie.name, "", {
          expires: new Date(0),
          path: "/",
        });
      }
    });
  } catch (error) {
    console.error("Error clearing cookies:", error);
  }

  // Force redirect to home page
  redirect("/");
}
