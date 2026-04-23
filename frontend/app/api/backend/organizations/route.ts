import { proxyToBackend } from "@/lib/api-proxy";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    return proxyToBackend("POST", "/internal/organizations", { body }, request);
  } catch (error) {
    console.error('Invalid JSON in organization POST request:', error);
    return new Response(JSON.stringify({ error: "Invalid request format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}