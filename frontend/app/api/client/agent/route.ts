// Stub — swap body for proxyToBackend() call once the Go backend has GET /internal/client/agent
export async function GET() {
  return Response.json({
    walletAddress: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    balanceUsdc: 25_000_000, // $25.00 in microunits
    savedCard: {
      brand: "visa",
      last4: "4242",
    },
  });
}
