import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import fp from "fastify-plugin";
import type { SangriaRequestData, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";

export interface FastifyConfig {
  bypassPaymentIf?: (request: FastifyRequest) => boolean | Promise<boolean>;
}

declare module "fastify" {
  interface FastifyRequest {
    sangria?: SangriaRequestData;
  }
}

// ── Fixed price: wrap a handler to gate it behind payment ──
//
//   fastify.get("/premium", fixedPrice(sangria, { price: 0.01 }, handler))
//
//   Note: register sangriaPlugin before using fixedPrice().
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  config?: FastifyConfig
) {
  validateFixedPriceOptions(options);

  return async (request: FastifyRequest, reply: FastifyReply) => {
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
      request.sangria = { paid: false, amount: 0 };
      return handler(request, reply);
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

    if (result.headers) {
      reply.headers(result.headers);
    }
    request.sangria = result.data;
    return handler(request, reply);
  };
}

// ── Upto (variable price): wrap a handler to gate it behind payment ──
//
//   fastify.get("/api/search",
//     uptoPrice(sangria, { maxPrice: 0.10 }, async (request, settle) => {
//       const results = doSearch(request.query.q);
//       return settle(results.length * 0.002, { results });
//     })
//   );
//
export function uptoPrice(
  sangria: Sangria,
  options: UptoPriceOptions,
  handler: (request: FastifyRequest, settle: SettleFn) => Promise<Settled>,
  config?: FastifyConfig
) {
  validateUptoPriceOptions(options);

  return async (request: FastifyRequest, reply: FastifyReply) => {
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
      request.sangria = { paid: false, amount: 0 };
      const { settleFn, getResult } = sangria.createSettleFn("", options.maxPrice);
      await handler(request, settleFn);
      const settleData = getResult();
      return reply.send(settleData?.body);
    }

    const paymentHeader = Array.isArray(request.headers["payment-signature"])
      ? request.headers["payment-signature"][0]
      : request.headers["payment-signature"];
    const resourceUrl = `${request.protocol}://${request.hostname}${request.url}`;

    if (!paymentHeader) {
      const generateResult = await sangria.generateUptoPayment(
        { paymentHeader: undefined, resourceUrl },
        options
      );
      if (generateResult.action === "respond") {
        if (generateResult.headers) {
          reply.headers(generateResult.headers);
        }
        return reply.status(generateResult.status).send(generateResult.body);
      }
      throw new Error("Sangria: unexpected generate result");
    }

    const verifyResult = await sangria.verifyPayment(
      paymentHeader,
      toMicrounits(options.maxPrice)
    );
    if (!verifyResult.valid) {
      return reply.status(402).send({
        error: verifyResult.message ?? "Payment verification failed",
        error_reason: verifyResult.reason,
      });
    }

    const { settleFn, getResult } = sangria.createSettleFn(paymentHeader, options.maxPrice);

    try {
      await handler(request, settleFn);
    } catch (handlerErr) {
      try { await sangria.settleUptoPayment(paymentHeader, 0); } catch { /* best-effort release */ }
      throw handlerErr;
    }

    const settleData = getResult();
    if (!settleData) {
      throw new Error("Sangria: handler must call settle()");
    }

    const settleResult = await sangria.settleUptoPayment(
      paymentHeader!,
      toMicrounits(settleData.amount)
    );

    if (!settleResult.success) {
      return reply.status(402).send({
        error: settleResult.error_message ?? "Payment settlement failed",
        error_reason: settleResult.error_reason,
      });
    }

    const paymentResponse = toBase64(
      JSON.stringify({
        success: true,
        transaction: settleResult.transaction,
        network: settleResult.network,
        payer: settleResult.payer,
      })
    );
    reply.header("PAYMENT-RESPONSE", paymentResponse);

    request.sangria = {
      paid: true,
      amount: settleData.amount,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer,
    };

    return reply.send(settleData.body);
  };
}

/** Register this plugin before using fixedPrice() or uptoPrice() */
export const sangriaPlugin = fp(
  async (fastify: FastifyInstance) => {
    fastify.decorateRequest("sangria", undefined);
  },
  { name: "sangria" }
);
