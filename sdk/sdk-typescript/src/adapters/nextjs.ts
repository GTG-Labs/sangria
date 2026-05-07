import type { SangriaRequestData, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";

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
    const handlerResponse = await handler(request, context);

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
  config?: NextJSConfig
): NextRouteHandler {
  validateUptoPriceOptions(options);

  return async (request: any, context?: any) => {
    let shouldBypass = false;
    if (config?.bypassPaymentIf) {
      try {
        const result = await config.bypassPaymentIf(request);
        shouldBypass = result === true;
      } catch (err) {
        console.error(
          "[sangria-sdk] bypassPaymentIf threw; falling through to payment required",
          err,
        );
        shouldBypass = false;
      }
    }
    if (shouldBypass) {
      request.sangria = { paid: false, amount: 0 } as SangriaRequestData;
      const { settleFn, getResult } = sangria.createSettleFn("", options.maxPrice);
      await handler(request, settleFn, context);
      const settleData = getResult();
      return new Response(JSON.stringify(settleData?.body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

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

    const { settleFn, getResult } = sangria.createSettleFn(paymentHeader, options.maxPrice);

    await handler(request, settleFn, context);

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
