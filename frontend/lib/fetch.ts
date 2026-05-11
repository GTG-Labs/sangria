/* eslint-disable @typescript-eslint/no-explicit-any */
// Enhanced fetch wrapper with automatic CSRF protection
// Server-safe CSRF token retrieval
function getCSRFToken(): string | null {
  if (typeof document !== 'undefined') {
    // Try cookie first (matches backend)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const trimmed = cookie.trim();
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      // slice(idx + 1), not split('=')[1], so tokens containing '=' aren't
      // truncated at the first occurrence.
      if (trimmed.slice(0, idx) === 'csrf_token') {
        return trimmed.slice(idx + 1);
      }
    }

    // Fallback to sessionStorage if available
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem('csrf_token');
    }
  }
  return null;
}

// Store CSRF token in cookie and sessionStorage
function setCSRFToken(token: string): void {
  if (typeof window !== 'undefined') {
    // Store in cookie for cross-origin sharing with backend
    document.cookie = `csrf_token=${token}; path=/; SameSite=Lax`;
    // Also keep in sessionStorage as backup
    sessionStorage.setItem('csrf_token', token);
  }
}

// Fetch CSRF token if not available in storage
async function getOrFetchCSRFToken(): Promise<string | null> {
  // First check if token exists in storage
  let token = getCSRFToken();
  if (token) {
    return token;
  }

  // If no token found, fetch one from the server
  try {
    const response = await globalThis.fetch('/api/csrf-token', {
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      token = data.csrf_token;
      if (token) {
        setCSRFToken(token);
        return token;
      }
    }
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
  }

  return null;
}

// Override the global fetch with CSRF-aware version and global 401 handling
export async function internalFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Prepare headers
  const headers = new Headers(options.headers);

  // Add CSRF token to headers for state-changing requests
  if (options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
    const csrfToken = await getOrFetchCSRFToken();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  // Make the request with CSRF token
  const response = await globalThis.fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Always send cookies
  });

  // Global 401 handling for banking security
  if (response.status === 401) {
    console.warn('Session expired - redirecting to login');

    // Store current location for post-login redirect
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('redirect_after_login', window.location.pathname);
    }

    // For banking apps, immediately redirect to login on any 401
    if (typeof window !== 'undefined') {
      // Trigger WorkOS sign-in flow by redirecting to a route that calls handleSignIn
      window.location.href = '/signin?reason=session_expired';
    }

    // Throw error to prevent component from trying to process the response
    throw new Error('Your session has expired for security reasons. Please log in again.');
  }

  // Global 403 handling - access denied
  if (response.status === 403) {
    console.warn('Access denied for request:', url);
    throw new Error('Access denied. You do not have permission to perform this action.');
  }

  return response;
}

// Convenience methods for cleaner API calls
export const api = {
  get: (url: string, options: RequestInit = {}) =>
    internalFetch(url, { ...options, method: 'GET' }),

  post: (url: string, body?: any, options: RequestInit = {}) =>
    internalFetch(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: (url: string, body?: any, options: RequestInit = {}) =>
    internalFetch(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: (url: string, options: RequestInit = {}) =>
    internalFetch(url, { ...options, method: 'DELETE' }),
};
