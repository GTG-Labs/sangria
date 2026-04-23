import { NextRequest } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL;

export async function GET(request: NextRequest) {
  try {
    // Forward cookies from frontend to backend
    const cookieHeader = request.headers.get('cookie') || '';

    // Proxy CSRF token request to Go backend
    const response = await fetch(`${BACKEND_URL}/csrf-token`, {
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

    // Forward Set-Cookie headers from backend to frontend
    const setCookieHeader = response.headers.get('Set-Cookie');
    if (setCookieHeader) {
      responseHeaders.set('Set-Cookie', setCookieHeader);
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