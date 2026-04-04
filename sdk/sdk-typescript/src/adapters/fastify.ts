import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  preHandlerAsyncHookHandler,
} from "fastify";
import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { SangriaNet } from "../core.js";

export interface FastifyConfig {
  bypassPaymentIf?: (request: FastifyRequest) => boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    sangrianet?: SangriaRequestData;
  }
}

// ── Entry point: add as preHandler to gate a route behind payment ──
//
//   fastify.get("/premium", { preHandler: fixedPrice(sangrianet, { price: 0.01 }) }, handler)
//
//   Note: register sangrianetPlugin before using fixedPrice().
//
export function fixedPrice(
  sangrianet: SangriaNet,
  options: FixedPriceOptions,
  config?: FastifyConfig
): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (config?.bypassPaymentIf?.(request)) {
      request.sangrianet = { paid: false, amount: 0 };
      return;
    }

    const result = await sangrianet.handleFixedPrice(
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

    request.sangrianet = result.data;
  };
}

/** Register this plugin before using fixedPrice() */
export async function sangrianetPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("sangrianet", undefined);
}
