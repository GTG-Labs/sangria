import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { SangriaNet } from "../core.js";

type SangriaNetEnv = {
  Variables: {
    sangrianet: SangriaRequestData;
  };
};

type SangriaNetContext = Parameters<MiddlewareHandler<SangriaNetEnv>>[0];

export interface HonoConfig {
  bypassPaymentIf?: (c: SangriaNetContext) => boolean;
}

export function getSangriaNet(
  c: SangriaNetContext
): SangriaRequestData | undefined {
  return c.get("sangrianet");
}

export function fixedPrice(
  sangrianet: SangriaNet,
  options: FixedPriceOptions,
  config?: HonoConfig
): MiddlewareHandler<SangriaNetEnv> {
  sangrianet.validateFixedPriceOptions(options);

  return async (c, next) => {
    if (config?.bypassPaymentIf?.(c)) {
      c.set("sangrianet", { paid: false, amount: 0 });
      return next();
    }

    const url = new URL(c.req.url);
    const result = await sangrianet.handleFixedPrice(
      {
        paymentHeader: c.req.header("payment-signature"),
        resourceUrl: url.origin + url.pathname + url.search,
      },
      options
    );

    if (result.action === "respond") {
      return c.json(
        result.body as Record<string, unknown>,
        result.status as ContentfulStatusCode
      );
    }

    c.set("sangrianet", result.data);
    return next();
  };
}
