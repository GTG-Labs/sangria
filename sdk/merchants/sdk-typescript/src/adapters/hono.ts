import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SangriaRequestData, SangriaTransaction, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";
import { SangriaHandlerError } from "../errors.js";

type SangriaEnv = {
  Variables: {
    sangria: SangriaRequestData;
    sangriaClient: Sangria;
  };
};

type SangriaContext = Parameters<MiddlewareHandler<SangriaEnv>>[0];

// ── Entry point: add as middleware to gate a route behind payment ──
//
//   app.get("/premium", fixedPrice(sangria, { price: 0.01 }), handler)
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
): MiddlewareHandler<SangriaEnv> {
  validateFixedPriceOptions(options);

  return async (c, next) => {
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
): MiddlewareHandler<SangriaEnv> {
  validateUptoPriceOptions(options);

  return async (c, _next) => {
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

    const { settleFn, getResult } = sangria.createSettleFn(options.maxPrice);

    try {
      await handler(c, settleFn);
    } catch (err) {
      if (err instanceof SangriaHandlerError) {
        return c.json(err.body as Record<string, unknown>, err.statusCode as ContentfulStatusCode);
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

// ── Middleware: register Sangria instance on Hono context ──
//
//   app.use(sangriaMiddleware(sangria));
//
export function sangriaMiddleware(sangria: Sangria): MiddlewareHandler<SangriaEnv> {
  return async (c, next) => {
    c.set("sangriaClient", sangria);
    await next();
  };
}

// ── Computed price: dynamic exact pricing based on request ──
//
//   app.post("/buy",
//     computedPrice(calcPrice, async (c, transaction) => {
//       return c.json({ success: true, transactionId: transaction.hash });
//     })
//   );
//
//   calcPrice is called on every request (both the initial 402 and the paid
//   retry). The second call is what detects body tampering — if an attacker
//   replays a signature with a modified body, the recomputed price won't match
//   the signed amount and the request is rejected before settlement.
//
export function computedPrice(
  calcPrice: (c: SangriaContext) => number | Promise<number>,
  handler: (c: SangriaContext, transaction: SangriaTransaction) => Promise<Response>
): MiddlewareHandler<SangriaEnv> {
  return async (c, _next) => {
    const sangria = c.get("sangriaClient");
    if (!sangria) {
      throw new Error(
        "Sangria: register sangriaMiddleware(sangria) before using computedPrice()"
      );
    }

    const price = await calcPrice(c);

    const url = new URL(c.req.url);
    const result = await sangria.handleFixedPrice(
      {
        paymentHeader: c.req.header("payment-signature"),
        resourceUrl: url.origin + url.pathname + url.search,
      },
      { price }
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

    if (toMicrounits(result.data.amount) !== toMicrounits(price)) {
      return c.json(
        { error: "Price mismatch: settled amount differs from computed price" } as Record<string, unknown>,
        409 as ContentfulStatusCode
      );
    }

    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) {
        c.header(key, value);
      }
    }
    c.set("sangria", result.data);

    const transaction: SangriaTransaction = {
      hash: result.data.transaction!,
      network: result.data.network!,
      payer: result.data.payer!,
      amount: result.data.amount,
    };

    return handler(c, transaction);
  };
}
