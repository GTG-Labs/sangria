import { proxyToBackend } from "@/lib/api-proxy";

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.toString();
  const path = search
    ? `/internal/client/topups?${search}`
    : "/internal/client/topups";
  return proxyToBackend("GET", path, {}, request);
}

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error("Invalid JSON in client topups POST request:", error);
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

  return proxyToBackend(
    "POST",
    "/internal/client/topups",
    { body },
    request,
  );
}
