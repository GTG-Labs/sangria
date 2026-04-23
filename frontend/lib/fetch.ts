// Enhanced fetch wrapper with automatic CSRF protection
// Server-safe CSRF token retrieval
function getCSRFToken(): string | null {
  if (typeof document !== 'undefined') {
    // Try cookie first (matches backend)
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf_token') {
        return value;
      }
    }

    // Fallback to sessionStorage if available
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem('csrf_token');
    }
  }
  return null;
}

// Override the global fetch with CSRF-aware version
export async function fetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Get CSRF token from storage
  const csrfToken = getCSRFToken();

  // Prepare headers
  const headers = new Headers(options.headers);

  // Add CSRF token to headers for state-changing requests
  if (options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }
  }

  // Make the request with CSRF token
  return globalThis.fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Always send cookies
  });
}

// Convenience methods for cleaner API calls
export const api = {
  get: (url: string, options: RequestInit = {}) =>
    fetch(url, { ...options, method: 'GET' }),

  post: (url: string, body?: any, options: RequestInit = {}) =>
    fetch(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: (url: string, body?: any, options: RequestInit = {}) =>
    fetch(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: (url: string, options: RequestInit = {}) =>
    fetch(url, { ...options, method: 'DELETE' }),
};