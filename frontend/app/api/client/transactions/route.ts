import { withAuth } from "@workos-inc/authkit-nextjs";

// Stub — swap body for proxyToBackend() call once the Go backend has GET /internal/client/transactions
export async function GET() {
  const { user } = await withAuth();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const now = Date.now();
  const stub = [
    {
      id: "1",
      resource: "api.weather.example.com/forecast",
      amount: 500_000,
      currency: "USDC",
      status: "confirmed",
      created_at: new Date(now - 2 * 60 * 1000).toISOString(),
    },
    {
      id: "2",
      resource: "api.search.example.com/query",
      amount: 250_000,
      currency: "USDC",
      status: "confirmed",
      created_at: new Date(now - 35 * 60 * 1000).toISOString(),
    },
    {
      id: "3",
      resource: "api.maps.example.com/directions",
      amount: 1_000_000,
      currency: "USDC",
      status: "confirmed",
      created_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "4",
      resource: "api.translate.example.com/v2",
      amount: 100_000,
      currency: "USDC",
      status: "confirmed",
      created_at: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "5",
      resource: "api.data.example.com/stocks",
      amount: 750_000,
      currency: "USDC",
      status: "failed",
      created_at: new Date(now - 50 * 60 * 60 * 1000).toISOString(),
    },
  ];

  return Response.json({
    data: stub,
    pagination: {
      next_cursor: null,
      has_more: false,
      count: stub.length,
      limit: 20,
      total: stub.length,
    },
  });
}
