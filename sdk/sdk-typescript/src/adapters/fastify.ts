import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerAsyncHookHandler,
} from "fastify";
import fp from "fastify-plugin";
import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { Sangria, validateFixedPriceOptions } from "../core.js";

export interface FastifyConfig {
  bypassPaymentIf?: (request: FastifyRequest) => boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    sangria?: SangriaRequestData;
  }
}

// ── Entry point: add as preHandler to gate a route behind payment ──
//
//   fastify.get("/premium", { preHandler: fixedPrice(sangria, { price: 0.01 }) }, handler)
//
//   Note: register sangriaPlugin before using fixedPrice().
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
  config?: FastifyConfig
): preHandlerAsyncHookHandler {
  validateFixedPriceOptions(options);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    let shouldBypass = false;
    if (config?.bypassPaymentIf) {
      try {
        shouldBypass = config.bypassPaymentIf(request);
      } catch (err) {
        // Fail closed: if the merchant's bypass callback throws, enforce
        // payment rather than risk letting the request through for free.
        console.error(
          "[sangria-sdk] bypassPaymentIf threw; falling through to payment required",
          err,
        );
        shouldBypass = false;
      }
    }
    if (shouldBypass) {
      request.sangria = { paid: false, amount: 0 };
      return;
    }

    const result = await sangria.handleFixedPrice(
      {
        paymentHeader: Array.isArray(request.headers["payment-signature"])
          ? request.headers["payment-signature"][0]
          : request.headers["payment-signature"],
        resourceUrl: `${request.protocol}://${request.hostname}${request.url}`,
      },
      options
    );

    if (result.action === "respond") {
      if (result.headers) {
        reply.headers(result.headers);
      }
      return reply.status(result.status).send(result.body);
    }

    request.sangria = result.data;
  };
}

/** Register this plugin before using fixedPrice() */
export const sangriaPlugin = fp(
  async (fastify: FastifyInstance) => {
    fastify.decorateRequest("sangria", undefined);
  },
  { name: "sangria" }
);
