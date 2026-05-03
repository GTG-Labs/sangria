import { handleAuth } from "@workos-inc/authkit-nextjs";
import { env } from "@/lib/env";

export const GET = handleAuth({
  baseURL: env.BASE_URL,
  returnPathname: "/dashboard/api-keys",
  onSuccess: async (authData: { user?: any; accessToken?: string }) => {
    const accessToken = authData.accessToken;
    if (!accessToken) {
      throw new Error("Missing access token");
    }

    // Get CSRF token - will throw on failure
    const csrfResponse = await fetch(`${env.BACKEND_URL}/csrf-token`);
    if (!csrfResponse.ok) {
      throw new Error(`Failed to get CSRF token: ${csrfResponse.status}`);
    }
    const { token: csrfToken } = await csrfResponse.json();

    // Create user - will throw on failure
    const response = await fetch(`${env.BACKEND_URL}/internal/users`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create user: ${response.status} ${errorText}`);
    }

    // Only reaches here on success - redirect proceeds
    console.log("User record created successfully");
  },
});
