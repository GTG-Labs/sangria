import { NextRequest } from 'next/server';
import { env } from '@/lib/env';

export async function GET(request: NextRequest) {
  try {
    // Forward cookies from frontend to backend
    const cookieHeader = request.headers.get('cookie') || '';

    // Proxy CSRF token request to Go backend
    const response = await fetch(`${env.BACKEND_URL}/csrf-token`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader, // Forward existing cookies
      },
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    // Prepare response headers
    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });

    // Forward Set-Cookie headers from backend to frontend (preserve multiple cookies)
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      responseHeaders.append('Set-Cookie', cookie);
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Failed to fetch CSRF token from backend:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate CSRF token' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}