import { handleAuth } from "@workos-inc/authkit-nextjs";

export const GET = handleAuth({
  returnPathname: "/dashboard/api-keys",
  onSuccess: async (authData: { user?: any; accessToken?: string }) => {
    const accessToken = authData.accessToken;
    if (!accessToken || !process.env.BACKEND_URL) {
      console.warn("Skipping user upsert: missing access token or BACKEND_URL");
      return;
    }

    // Call Go backend to upsert user record on login
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${process.env.BACKEND_URL}/internal/users`, {
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
