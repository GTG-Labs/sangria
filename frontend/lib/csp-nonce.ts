/**
 * Utility functions for accessing CSP nonce on client and server side
 */

import { headers, cookies } from 'next/headers';

/**
 * Get CSP nonce from cookies (client-side)
 */
export function getClientNonce(): string | null {
  if (typeof window === 'undefined') return null;

  const cookies = document.cookie.split(';');
  const nonceCookie = cookies.find(cookie =>
    cookie.trim().startsWith('csp-nonce=')
  );

  return nonceCookie ? nonceCookie.split('=')[1] : null;
}

/**
 * Get CSP nonce from headers (server-side)
 */
export async function getServerNonce(): Promise<string | null> {
  if (typeof window !== 'undefined') return null;

  try {
    const headersList = await headers();
    return headersList.get('x-nonce');
  } catch {
    // Fallback to cookies if headers not available
    try {
      const cookieStore = await cookies();
      return cookieStore.get('csp-nonce')?.value || null;
    } catch {
      return null;
    }
  }
}

/**
 * Get CSP nonce (works on both client and server)
 */
export async function getNonce(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    return getClientNonce();
  } else {
    return await getServerNonce();
  }
}

/**
 * Create a script element with proper nonce attribute
 */
export function createNoncedScript(content: string, nonce?: string): HTMLScriptElement | null {
  if (typeof window === 'undefined') return null;

  const scriptNonce = nonce || getClientNonce();
  if (!scriptNonce) return null;

  const script = document.createElement('script');
  script.nonce = scriptNonce;
  script.textContent = content;

  return script;
}