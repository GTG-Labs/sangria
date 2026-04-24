import { handleAuth } from "@workos-inc/authkit-nextjs";
import { env } from "@/lib/env";

export const GET = handleAuth({
  baseURL: env.BASE_URL,
  returnPathname: "/dashboard/api-keys",
  onSuccess: async (authData: { user?: any; accessToken?: string }) => {
    const accessToken = authData.accessToken;
    if (!accessToken) {
      console.warn("Skipping user upsert: missing access token");
      return;
    }

    // Call Go backend to upsert user record on login
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${env.BACKEND_URL}/internal/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to upsert user: ${response.status} ${errorText}`);
      } else {
        console.log("User record upserted successfully");
      }
    } catch (error) {
      clearTimeout(timeoutId);
      console.error("Error upserting user:", error);
    }
  },
});
