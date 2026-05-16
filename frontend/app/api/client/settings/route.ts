import { withAuth } from "@workos-inc/authkit-nextjs";

// Stub — swap GET body for proxyToBackend("GET", "/internal/client/settings", {}, request)
//        swap PATCH body for proxyToBackend("PATCH", "/internal/client/settings", { body }, request)
// Backend contract: GET /internal/client/settings, PATCH /internal/client/settings
// All amounts in microunits (1 USD = 1_000_000). null = no limit enforced.

const DEFAULT_SETTINGS = {
  dailyLimit: 10_000_000,    // $10.00/day
  monthlyLimit: 100_000_000, // $100.00/month
  perRunCap: 1_000_000,      // $1.00/request
};

const ALLOWED_FIELDS = ["dailyLimit", "monthlyLimit", "perRunCap"] as const;

export async function GET() {
  const { user } = await withAuth();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  return Response.json(DEFAULT_SETTINGS);
}

export async function PATCH(request: Request) {
  const { user } = await withAuth();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

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

  const input = body as Record<string, unknown>;
  const validatedFields: Record<string, number | null> = {};
  for (const field of ALLOWED_FIELDS) {
    if (!(field in input)) continue;
    const value = input[field];
    if (value === null) {
      validatedFields[field] = null;
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return Response.json(
        { error: `Invalid ${field}: must be null or a non-negative integer (microunits)` },
        { status: 400 }
      );
    }
    validatedFields[field] = value;
  }

  const merged = { ...DEFAULT_SETTINGS, ...validatedFields };
  return Response.json(merged);
}
