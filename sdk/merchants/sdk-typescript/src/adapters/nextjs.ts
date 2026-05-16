import type { SangriaRequestData, SangriaTransaction, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";
import { SangriaHandlerError } from "../errors.js";

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

// ── Entry point: wrap a route handler to gate it behind payment ──
//
//   import { fixedPrice } from "@sangria-sdk/core/nextjs";
//
//   export const GET = fixedPrice(sangria, { price: 0.01 }, handler);
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
  handler: NextRouteHandler,
): NextRouteHandler {
  validateFixedPriceOptions(options);

  return async (request: any, context?: any) => {
    const paymentHeader =
      request.headers.get("payment-signature") ?? undefined;
    const resourceUrl = request.url;

    const result = await sangria.handleFixedPrice(
      { paymentHeader, resourceUrl },
      options
    );

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

    request.sangria = result.data;
    let handlerResponse: any;
    try {
      handlerResponse = await handler(request, context);
    } catch (err) {
      if (err instanceof SangriaHandlerError) {
        return new Response(JSON.stringify(err.body), {
          status: err.statusCode,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    // Attach x402 PAYMENT-RESPONSE header to the handler's response
    if (result.headers && handlerResponse instanceof Response) {
      const merged = new Headers(handlerResponse.headers);
      for (const [k, v] of Object.entries(result.headers)) {
        merged.set(k, v);
      }
      return new Response(handlerResponse.body, {
        status: handlerResponse.status,
        statusText: handlerResponse.statusText,
        headers: merged,
      });
    }

    return handlerResponse;
  };
}

// ── Upto (variable price): wrap a route handler to gate it behind payment ──
//
//   import { uptoPrice } from "@sangria-sdk/core/nextjs";
//
//   export const GET = uptoPrice(sangria, { maxPrice: 0.10 }, async (request, settle) => {
//     const results = doSearch(new URL(request.url).searchParams.get("q"));
//     return settle(results.length * 0.002, { results });
//   });
//
export function uptoPrice(
  sangria: Sangria,
  options: UptoPriceOptions,
  handler: (request: any, settle: SettleFn, context?: any) => Promise<Settled>,
): NextRouteHandler {
  validateUptoPriceOptions(options);

  return async (request: any, context?: any) => {
    const paymentHeader =
      request.headers.get("payment-signature") ?? undefined;
    const resourceUrl = request.url;

    if (!paymentHeader) {
      const generateResult = await sangria.generateUptoPayment(
        { paymentHeader: undefined, resourceUrl },
        options
      );
      if (generateResult.action === "respond") {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...generateResult.headers,
        };
        return new Response(JSON.stringify(generateResult.body), {
          status: generateResult.status,
          headers,
        });
      }
      throw new Error("Sangria: unexpected generate result");
    }

    const verifyResult = await sangria.verifyPayment(
      paymentHeader,
      toMicrounits(options.maxPrice)
    );
    if (!verifyResult.valid) {
      return new Response(
        JSON.stringify({
          error: verifyResult.message ?? "Payment verification failed",
          error_reason: verifyResult.reason,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    const { settleFn, getResult } = sangria.createSettleFn(options.maxPrice);

    try {
      await handler(request, settleFn, context);
    } catch (err) {
      if (err instanceof SangriaHandlerError) {
        return new Response(JSON.stringify(err.body), {
          status: err.statusCode,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    const settleData = getResult();
    if (!settleData) {
      throw new Error("Sangria: handler must call settle()");
    }

    const settleResult = await sangria.settleUptoPayment(
      paymentHeader,
      toMicrounits(settleData.amount)
    );

    if (!settleResult.success) {
      return new Response(
        JSON.stringify({
          error: settleResult.error_message ?? "Payment settlement failed",
          error_reason: settleResult.error_reason,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }

    const paymentResponse = toBase64(JSON.stringify({
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer,
    }));

    request.sangria = {
      paid: true,
      amount: settleData.amount,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer,
    } as SangriaRequestData;

    return new Response(JSON.stringify(settleData.body), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-RESPONSE": paymentResponse,
      },
    });
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

// ── Computed price: dynamic exact pricing based on request ──
//
//   // app/api/buy/route.ts
//   export const POST = computedPrice(sangria, calcPrice, async (request, transaction) => {
//     return Response.json({ success: true, transactionId: transaction.hash });
//   });
//
//   calcPrice is called on every request (both the initial 402 and the paid
//   retry). The second call is what detects body tampering — if an attacker
//   replays a signature with a modified body, the recomputed price won't match
//   the signed amount and the request is rejected before settlement.
//
export function computedPrice(
  sangria: Sangria,
  calcPrice: (request: any) => number | Promise<number>,
  handler: (request: any, transaction: SangriaTransaction) => Promise<any> | any
): NextRouteHandler {
  return async (request: any, context?: any) => {
    const price = await calcPrice(request);

    const paymentHeader =
      request.headers.get("payment-signature") ?? undefined;
    const resourceUrl = request.url;

    const result = await sangria.handleFixedPrice(
      { paymentHeader, resourceUrl },
      { price }
    );

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

    if (toMicrounits(result.data.amount) !== toMicrounits(price)) {
      return new Response(
        JSON.stringify({ error: "Price mismatch: settled amount differs from computed price" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    request.sangria = result.data;

    const transaction: SangriaTransaction = {
      hash: result.data.transaction!,
      network: result.data.network!,
      payer: result.data.payer!,
      amount: result.data.amount,
    };

    let handlerResponse = await handler(request, transaction);

    if (result.headers && handlerResponse instanceof Response) {
      const merged = new Headers(handlerResponse.headers);
      for (const [k, v] of Object.entries(result.headers)) {
        merged.set(k, v);
      }
      return new Response(handlerResponse.body, {
        status: handlerResponse.status,
        statusText: handlerResponse.statusText,
        headers: merged,
      });
    }

    return handlerResponse;
  };
}
