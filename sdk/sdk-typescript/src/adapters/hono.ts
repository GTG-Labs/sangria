import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { Sangria, validateFixedPriceOptions } from "../core.js";

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

    c.set("sangria", result.data);
    return next();
  };
}

export function getSangria(c: SangriaContext): SangriaRequestData | undefined {
  return c.get("sangria");
}
