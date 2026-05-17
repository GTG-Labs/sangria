import { proxyToBackend } from "@/lib/api-proxy";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // URL-encode the dynamic segment before interpolation — see root CLAUDE.md
  // § Next.js App Conventions for why.
  return proxyToBackend(
    "DELETE",
    `/internal/client/agent/keys/${encodeURIComponent(id)}`,
    { rawResponse: true },
    request,
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error("Invalid JSON in client agent-key PATCH request:", error);
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
    "PATCH",
    `/internal/client/agent/keys/${encodeURIComponent(id)}`,
    { body, rawResponse: true },
    request,
  );
}
