import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SangriaRequestData, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";

type SangriaEnv = {
  Variables: {
    sangria: SangriaRequestData;
  };
};

type SangriaContext = Parameters<MiddlewareHandler<SangriaEnv>>[0];

export interface HonoConfig {
  bypassPaymentIf?: (c: SangriaContext) => boolean | Promise<boolean>;
}

// ── Entry point: add as middleware to gate a route behind payment ──
//
//   app.get("/premium", fixedPrice(sangria, { price: 0.01 }), handler)
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
  config?: HonoConfig
): MiddlewareHandler<SangriaEnv> {
  validateFixedPriceOptions(options);

  return async (c, next) => {
    let shouldBypass = false;
    if (config?.bypassPaymentIf) {
      try {
        // Await handles async callbacks; strict === true rejects Promises/truthy non-booleans.
        const result = await config.bypassPaymentIf(c);
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
      c.set("sangria", { paid: false, amount: 0 });
      return next();
    }

    const url = new URL(c.req.url);
    const result = await sangria.handleFixedPrice(
      {
        paymentHeader: c.req.header("payment-signature"),
        resourceUrl: url.origin + url.pathname + url.search,
      },
      options
    );

    if (result.action === "respond") {
      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          c.header(key, value);
        }
      }
      return c.json(
        result.body as Record<string, unknown>,
        result.status as ContentfulStatusCode
      );
    }

    // Attach x402 PAYMENT-RESPONSE header to the outgoing response
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        c.header(key, value);
      }
    }
    c.set("sangria", result.data);
    return next();
  };
}

// ── Upto (variable price): wrap a handler to gate it behind payment ──
//
//   app.get("/api/search",
//     uptoPrice(sangria, { maxPrice: 0.10 }, async (c, settle) => {
//       const results = doSearch(c.req.query("q"));
//       return settle(results.length * 0.002, { results });
//     })
//   );
//
export function uptoPrice(
  sangria: Sangria,
  options: UptoPriceOptions,
  handler: (c: SangriaContext, settle: SettleFn) => Promise<Settled>,
  config?: HonoConfig
): MiddlewareHandler<SangriaEnv> {
  validateUptoPriceOptions(options);

  return async (c, _next) => {
    let shouldBypass = false;
    if (config?.bypassPaymentIf) {
      try {
        const result = await config.bypassPaymentIf(c);
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
      c.set("sangria", { paid: false, amount: 0 });
      const { settleFn, getResult } = sangria.createSettleFn("", options.maxPrice);
      await handler(c, settleFn);
      const settleData = getResult();
      return c.json(settleData?.body as Record<string, unknown>);
    }

    const paymentHeader = c.req.header("payment-signature");
    const url = new URL(c.req.url);
    const resourceUrl = url.origin + url.pathname + url.search;

    if (!paymentHeader) {
      const generateResult = await sangria.generateUptoPayment(
        { paymentHeader: undefined, resourceUrl },
        options
      );
      if (generateResult.action === "respond") {
        if (generateResult.headers) {
          for (const [key, value] of Object.entries(generateResult.headers)) {
            c.header(key, value);
          }
        }
        return c.json(
          generateResult.body as Record<string, unknown>,
          generateResult.status as ContentfulStatusCode
        );
      }
      throw new Error("Sangria: unexpected generate result");
    }

    const verifyResult = await sangria.verifyPayment(
      paymentHeader,
      toMicrounits(options.maxPrice)
    );
    if (!verifyResult.valid) {
      return c.json(
        {
          error: verifyResult.message ?? "Payment verification failed",
          error_reason: verifyResult.reason,
        } as Record<string, unknown>,
        402 as ContentfulStatusCode
      );
    }

    const { settleFn, getResult } = sangria.createSettleFn(paymentHeader, options.maxPrice);

    try {
      await handler(c, settleFn);
    } catch (handlerErr) {
      try { await sangria.settleUptoPayment(paymentHeader, 0); } catch { /* best-effort release */ }
      throw handlerErr;
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
      return c.json(
        {
          error: settleResult.error_message ?? "Payment settlement failed",
          error_reason: settleResult.error_reason,
        } as Record<string, unknown>,
        402 as ContentfulStatusCode
      );
    }

    const paymentResponse = toBase64(JSON.stringify({
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer,
    }));
    c.header("PAYMENT-RESPONSE", paymentResponse);

    c.set("sangria", {
      paid: true,
      amount: settleData.amount,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer,
    });

    return c.json(settleData.body as Record<string, unknown>);
  };
}

export function getSangria(c: SangriaContext): SangriaRequestData | undefined {
  return c.get("sangria");
}
