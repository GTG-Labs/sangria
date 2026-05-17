import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: Request) {
  return proxyToBackend("GET", "/internal/client/agent/keys", {}, request);
}

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error("Invalid JSON in client agent-keys POST request:", error);
    return new Response(JSON.stringify({ error: "Invalid request format" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { csrf_token: _csrf_token, ...sanitizedBody } = body;
  return proxyToBackend(
    "POST",
    "/internal/client/agent/keys",
    { body: sanitizedBody },
    request,
  );
}
