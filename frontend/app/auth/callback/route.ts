import { handleAuth } from "@workos-inc/authkit-nextjs";
import { env } from "@/lib/env";

export const GET = handleAuth({
  baseURL: env.BASE_URL,
  returnPathname: "/dashboard",
  onSuccess: async (authData) => {
    const accessToken = authData.accessToken;
    if (!accessToken) {
      throw new Error("Missing access token");
    }

    console.log("Auth callback - Starting user creation flow");

    // Create user directly on backend (no CSRF needed for server-side auth operations)
    const userController = new AbortController();
    const userTimeout = setTimeout(() => userController.abort(), 10000);
    try {
      console.log("Creating user via auth callback endpoint:", `${env.BACKEND_URL}/auth/users`);
      const response = await fetch(`${env.BACKEND_URL}/auth/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: userController.signal,
      });
      clearTimeout(userTimeout);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("User creation failed:", response.status, errorText);
          throw new Error(`Failed to create user: ${response.status} ${errorText}`);
        }

      // Only reaches here on success - redirect proceeds
      console.log("User record created successfully");
    } catch (err) {
      clearTimeout(userTimeout);
      console.error("User creation error:", err);
      throw err;
    }
  },
});
