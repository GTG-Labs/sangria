import { handleAuth } from '@workos-inc/authkit-nextjs';

export const GET = handleAuth({
  onSuccess: async (authData: { user?: any; accessToken?: string }) => {
    try {
      // Extract JWT access token from WorkOS authentication response
      const accessToken = authData.accessToken;
      if (!accessToken) {
        console.error('No access token received from WorkOS');
        return;
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
          console.error('Failed to create account:', await response.text());
        } else {
          console.log('Financial account created for user');
        }
      } catch (error) {
        clearTimeout(timeoutId); // Clear timeout on error
        console.error('Error creating financial account:', error);
      }
  },
});