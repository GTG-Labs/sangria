import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth({
  onSuccess: async (authData: { user?: any; accessToken?: string }) => {
    // Validate required data and fail fast
    const accessToken = authData.accessToken;
    if (!accessToken) {
      throw new Error('No access token received from WorkOS');
    }

    if (!process.env.BACKEND_URL) {
      throw new Error('BACKEND_URL environment variable is not set');
    }

    // Call Go backend to create/check financial account using JWT token
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(`${process.env.BACKEND_URL}/accounts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId); // Clear timeout on successful completion

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create account: ${response.status} ${errorText}`);
      }

      console.log('Financial account created for user');
    } catch (error) {
      clearTimeout(timeoutId); // Clear timeout on error

      // Re-throw the error to fail the authentication flow
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`Error creating financial account: ${error}`);
      }
    }
  },
});