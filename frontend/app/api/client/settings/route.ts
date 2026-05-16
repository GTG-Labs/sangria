// Stub — swap GET body for proxyToBackend("GET", "/internal/client/settings", {}, request)
//        swap PATCH body for proxyToBackend("PATCH", "/internal/client/settings", { body }, request)
// Backend contract: GET /internal/client/settings, PATCH /internal/client/settings
// All amounts in microunits (1 USD = 1_000_000). null = no limit enforced.

const DEFAULT_SETTINGS = {
  dailyLimit: 10_000_000,    // $10.00/day
  monthlyLimit: 100_000_000, // $100.00/month
  perRunCap: 1_000_000,      // $1.00/request
};

export async function GET() {
  return Response.json(DEFAULT_SETTINGS);
}

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    console.error("Invalid JSON in client settings PATCH request");
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a plain object" }, { status: 400 });
  }

  // Strip csrf_token before use (never forwarded to backend)
  const { csrf_token: _csrf, ...settings } = body as Record<string, unknown>;
  void _csrf;

  // Stub: echo back the submitted settings merged with defaults
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  return Response.json(merged);
}
