// CSRF Protection utilities (Client-side only)
import { useState, useEffect } from 'react';

// Client-side CSRF token utilities
// Note: All token generation and validation happens server-side
//
// 403 Recovery Pattern:
// When API calls return 403 (Invalid CSRF token), callers should:
// 1. Call refresh() from useCSRFToken to get a fresh token
// 2. Retry the original request with the new token
// 3. This avoids requiring a full page reload for token expiry

// Store CSRF token in sessionStorage (client-side only)
function setToken(token: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('csrf_token', token);
  }
}

// Get CSRF token from storage
function getToken(): string | null {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem('csrf_token');
  }
  return null;
}

// Clear CSRF token from storage
function clearToken(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('csrf_token');
  }
}

// Add CSRF token to form data
export function addTokenToFormData(formData: FormData): FormData {
  const token = getToken();
  if (token) {
    formData.append('csrf_token', token);
  }
  return formData;
}

// Add CSRF token to JSON payload with proper typing
export function addTokenToJSON<T extends object>(data: T): T & { csrf_token?: string } {
  const token = getToken();
  if (token) {
    return { ...data, csrf_token: token };
  }
  return data;
}

/**
 * React hook for CSRF protection - fetches server-generated tokens
 *
 * @returns Object containing:
 *   - token: Current CSRF token (null if not loaded)
 *   - refresh: Function to clear cached token and fetch a new one
 *   - addToFormData: Function to add current token to FormData
 *   - addToJSON: Function to add current token to JSON payload
 *
 * Usage for 403 recovery:
 * ```
 * const { refresh } = useCSRFToken();
 *
 * try {
 *   await apiCall();
 * } catch (error) {
 *   if (error.status === 403) {
 *     await refresh();
 *     await apiCall(); // Retry with fresh token
 *   }
 * }
 * ```
 */
export function useCSRFToken() {
  const [token, setTokenState] = useState<string | null>(() => {
    // Get existing token from storage if available
    if (typeof window === 'undefined') return null;
    return getToken();
  });

  // Fetch a new CSRF token from the server
  const fetchToken = async () => {
    try {
      const response = await fetch('/api/csrf-token');
      if (response.ok) {
        const data = await response.json();
        const serverToken = data.csrf_token;
        if (serverToken) {
          setToken(serverToken);
          setTokenState(serverToken);
          return serverToken;
        }
      }
      throw new Error(`Failed to fetch CSRF token: ${response.status}`);
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
      throw error;
    }
  };

  // Refresh the CSRF token (clears cached token and fetches a new one)
  const refresh = async (): Promise<string | null> => {
    // Clear stored token and state
    clearToken();
    setTokenState(null);

    try {
      return await fetchToken();
    } catch (error) {
      console.error('Failed to refresh CSRF token:', error);
      return null;
    }
  };

  // Fetch server-generated token if not available
  useEffect(() => {
    if (typeof window === 'undefined' || token) return;
    fetchToken().catch(() => {
      // Error already logged in fetchToken
    });
  }, [token]);

  // Create token-aware versions of helper functions that use hook state
  const addToFormData = (formData: FormData): FormData => {
    if (token) {
      formData.append('csrf_token', token);
    }
    return formData;
  };

  const addToJSON = <T extends object>(data: T): T & { csrf_token?: string } => {
    if (token) {
      return { ...data, csrf_token: token };
    }
    return data;
  };

  return {
    token,
    refresh,
    addToFormData,
    addToJSON,
  };
}