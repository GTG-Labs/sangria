import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { Sangria, validateFixedPriceOptions } from "../core.js";

/**
 * Minimal type stubs for Next.js request/response.
 *
 * We intentionally avoid importing from "next/server" so the adapter
 * compiles without next as a dependency. Consumers get full type safety
 * from their own Next.js installation. The `any` fallbacks here only
 * affect SDK internals, not the developer-facing API.
 */
type NextRequest = {
  headers: { get(name: string): string | null };
  url: string;
};

type NextResponse = any;

type NextRouteHandler = (
  request: any,
  context?: any
) => Promise<NextResponse> | NextResponse;

export interface NextJSConfig {
  bypassPaymentIf?: (request: any) => boolean | Promise<boolean>;
}

// ── Entry point: wrap a route handler to gate it behind payment ──
//
//   import { fixedPrice } from "@sangria-sdk/core/nextjs";
//
//   export const GET = fixedPrice(sangria, { price: 0.01 }, handler);
//   export const POST = fixedPrice(sangria, { price: 0.01 }, handler, config);
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
  handler: NextRouteHandler,
  config?: NextJSConfig
): NextRouteHandler {
  validateFixedPriceOptions(options);

  return async (request: any, context?: any) => {
    // 1. Bypass check — let the request through without payment
    let shouldBypass = false;
    if (config?.bypassPaymentIf) {
      try {
        // Await handles async callbacks; strict === true rejects Promises/truthy non-booleans.
        const result = await config.bypassPaymentIf(request);
        shouldBypass = result === true;
      } catch (err) {
        // Fail closed: any throw/reject enforces payment.
        console.error(
          "[sangria-sdk] bypassPaymentIf threw; falling through to payment required",
          err,
        );
        shouldBypass = false;
      }
    }
    if (shouldBypass) {
      request.sangria = { paid: false, amount: 0 } as SangriaRequestData;
      return handler(request, context);
    }

    // 2. Extract payment context from the request
    const paymentHeader =
      request.headers.get("payment-signature") ?? undefined;
    const resourceUrl = request.url;

    // 3. Call core payment logic
    const result = await sangria.handleFixedPrice(
      { paymentHeader, resourceUrl },
      options
    );

    // 4. Block: return 402 challenge or error response
    if (result.action === "respond") {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...result.headers,
      };
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers,
      });
    }

    // 5. Proceed: attach payment data to request, run handler
    request.sangria = result.data;
    return handler(request, context);
  };
}

// ── Helper to read payment data from the request ──
//
//   const payment = getSangria(request);
//   if (payment?.paid) { /* payment succeeded */ }
//
export function getSangria(
  request: any
): SangriaRequestData | undefined {
  return request.sangria;
}
