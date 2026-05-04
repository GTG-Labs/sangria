import { handleAuth } from "@workos-inc/authkit-nextjs";
import { env } from "@/lib/env";

export const GET = handleAuth({
  baseURL: env.BASE_URL,
  returnPathname: "/dashboard/api-keys",
  onSuccess: async (authData) => {
    const accessToken = authData.accessToken;
    if (!accessToken) {
      throw new Error("Missing access token");
    }

    console.log("Auth callback - BASE_URL:", env.BASE_URL);
    console.log("Auth callback - Starting user creation flow");

    // Get CSRF token from frontend (which forwards to backend and handles cookies)
    const csrfController = new AbortController();
    const csrfTimeout = setTimeout(() => csrfController.abort(), 5000);
    try {
      console.log("Fetching CSRF token via frontend:", `${env.BASE_URL}/api/csrf-token`);
      const csrfResponse = await fetch(`${env.BASE_URL}/api/csrf-token`, {
        signal: csrfController.signal,
      });
      clearTimeout(csrfTimeout);
      if (!csrfResponse.ok) {
        throw new Error(`Failed to get CSRF token: ${csrfResponse.status}`);
      }
      const { csrf_token: csrfToken } = await csrfResponse.json();
      console.log("CSRF token obtained successfully");

      // Create user directly on backend with timeout
      const userController = new AbortController();
      const userTimeout = setTimeout(() => userController.abort(), 10000);
      try {
        console.log("Creating user directly on backend:", `${env.BACKEND_URL}/internal/users`);
        const response = await fetch(`${env.BACKEND_URL}/internal/users`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
            "Cookie": `csrf_token=${csrfToken}`, // Backend CSRF middleware needs both header and cookie
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
    } catch (err) {
      clearTimeout(csrfTimeout);
      console.error("CSRF token error:", err);
      throw err;
    }
  },
});
