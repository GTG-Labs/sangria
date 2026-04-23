'use client';
// Client-side CSRF token utilities
import { useState, useEffect } from 'react';

// Store CSRF token in cookie (client-side only)
export function setToken(token: string): void {
  if (typeof window !== 'undefined') {
    // Store in cookie for cross-origin sharing with backend
    document.cookie = `csrf_token=${token}; path=/; SameSite=Lax`;
    // Also keep in sessionStorage as backup
    sessionStorage.setItem('csrf_token', token);
  }
}

// Get CSRF token from cookie (matches backend expectation)
export function getToken(): string | null {
  if (typeof window !== 'undefined') {
    // Try cookie first (matches backend)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf_token') {
        return value;
      }
    }

    // Fallback to sessionStorage
    return sessionStorage.getItem('csrf_token');
  }
  return null;
}

// Clear CSRF token from both storage methods
function clearToken(): void {
  if (typeof window !== 'undefined') {
    // Clear cookie
    document.cookie = 'csrf_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // Clear sessionStorage
    sessionStorage.removeItem('csrf_token');
  }
}

// Fetch fresh CSRF token from backend
async function fetchToken(): Promise<string | null> {
  try {
    const response = await globalThis.fetch('/api/csrf-token', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to fetch CSRF token:', response.statusText);
      return null;
    }

    const data = await response.json();

    if (data.csrf_token) {
      setToken(data.csrf_token);
      return data.csrf_token;
    }

    return null;
  } catch (error) {
    console.error('Error fetching CSRF token:', error);
    return null;
  }
}

/**
 * React hook for CSRF token management
 * Provides automatic token fetching and refresh capabilities
 *
 * @returns Object with token management functions:
 *   - token: Current CSRF token (string or null)
 *   - refresh: Function to refresh the token manually
 *   - addToFormData: Function to add current token to FormData
 *   - addToJSON: Function to add current token to JSON payload
 *   - handleAPICall: Wrapper for automatic 403 retry logic
 */
export function useCSRFToken() {
  const [token, setTokenState] = useState<string | null>(getToken());

  // Load token on mount if not already present
  useEffect(() => {
    if (typeof window === 'undefined' || token) return;
    fetchToken().catch(() => {
      // Error already logged in fetchToken
    });
  }, [token]);

  // Manual refresh function for 403 recovery
  const refresh = async (): Promise<string | null> => {
    clearToken();
    const newToken = await fetchToken();
    setTokenState(newToken);
    return newToken;
  };

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

  // Automatic retry helper for 403 CSRF errors
  const handleAPICall = async <T>(apiCall: () => Promise<T>): Promise<T> => {
    try {
      return await apiCall();
    } catch (error: unknown) {
      // Check if this is a 403 CSRF error
      const isCSRFError = (
        (error && typeof error === 'object' && 'status' in error && error.status === 403) ||
        (error instanceof Response && error.status === 403)
      );

      if (isCSRFError) {
        // Try to refresh token and retry once
        console.log('CSRF token invalid, refreshing...');
        const newToken = await refresh();

        if (newToken) {
          // Retry the original API call with fresh token
          return await apiCall();
        }
      }

      // Re-throw if not a CSRF error or refresh failed
      throw error;
    }
  };

  return {
    token,
    refresh,
    addToFormData,
    addToJSON,
    handleAPICall,
  };
}