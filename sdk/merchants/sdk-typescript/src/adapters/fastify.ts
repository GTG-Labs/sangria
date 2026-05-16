import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import fp from "fastify-plugin";
import type { SangriaRequestData, SangriaTransaction, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits, fromMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";
import { SangriaHandlerError } from "../errors.js";

export interface FastifyConfig {
  bypassPaymentIf?: (request: FastifyRequest) => boolean | Promise<boolean>;
}

export interface SangriaPluginOptions {
  sangria?: Sangria;
}

declare module "fastify" {
  interface FastifyRequest {
    sangria?: SangriaRequestData;
  }
  interface FastifyInstance {
    sangriaClient?: Sangria;
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
      try {
        return await handler(request, reply);
      } catch (err) {
        if (err instanceof SangriaHandlerError) {
          return reply.status(err.statusCode).send(err.body);
        }
        throw err;
      }
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
    try {
      return await handler(request, reply);
    } catch (err) {
      if (err instanceof SangriaHandlerError) {
        return reply.status(err.statusCode).send(err.body);
      }
      throw err;
    }
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
      const { settleFn, getResult } = sangria.createSettleFn(options.maxPrice);
      try {
        await handler(request, settleFn);
      } catch (err) {
        if (err instanceof SangriaHandlerError) {
          return reply.status(err.statusCode).send(err.body);
        }
        throw err;
      }
      const settleData = getResult();
      if (!settleData) {
        throw new Error("Sangria: handler must call settle()");
      }
      return reply.send(settleData.body);
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

    const { settleFn, getResult } = sangria.createSettleFn(options.maxPrice);

    try {
      await handler(request, settleFn);
    } catch (err) {
      if (err instanceof SangriaHandlerError) {
        return reply.status(err.statusCode).send(err.body);
      }
      throw err;
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

/** Register this plugin before using fixedPrice(), uptoPrice(), or computedPrice(). */
export const sangriaPlugin = fp(
  async (fastify: FastifyInstance, opts: SangriaPluginOptions) => {
    fastify.decorateRequest("sangria", undefined);
    if (opts.sangria) {
      fastify.decorate("sangriaClient", opts.sangria);
    }
  },
  { name: "sangria" }
);

// ── Computed price: dynamic exact pricing based on request ──
//
//   fastify.post("/buy",
//     computedPrice(calcPrice, async (request, reply, transaction) => {
//       return { success: true, transactionId: transaction.hash };
//     })
//   );
//
//   Note: register sangriaPlugin with { sangria } before using computedPrice().
//
//   calcPrice is called on every request (both the initial 402 and the paid
//   retry). The second call is what detects body tampering — if an attacker
//   replays a signature with a modified body, the recomputed price won't match
//   the signed amount and the request is rejected before settlement.
//
//   bypassPaymentIf is intentionally not supported here. The existing bypass
//   implementation in fixedPrice/uptoPrice is being reworked; adding a known-
//   faulty variant to a new API surface would just create more migration work.
//
export function computedPrice<T = unknown>(
  calcPrice: (request: FastifyRequest) => number | Promise<number>,
  handler: (request: FastifyRequest, reply: FastifyReply, transaction: SangriaTransaction) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const sangria = request.server.sangriaClient;
    if (!sangria) {
      throw new Error(
        "Sangria: register sangriaPlugin with { sangria } option before using computedPrice()"
      );
    }

    const price = await calcPrice(request);

    const result = await sangria.handleFixedPrice(
      {
        paymentHeader: Array.isArray(request.headers["payment-signature"])
          ? request.headers["payment-signature"][0]
          : request.headers["payment-signature"],
        resourceUrl: `${request.protocol}://${request.hostname}${request.url}`,
      },
      { price }
    );

    if (result.action === "respond") {
      if (result.headers) {
        reply.headers(result.headers);
      }
      return reply.status(result.status).send(result.body);
    }

    if (toMicrounits(result.data.amount) !== toMicrounits(price)) {
      return reply.status(409).send({
        error: "Price mismatch: settled amount differs from computed price",
      });
    }

    if (result.headers) {
      reply.headers(result.headers);
    }
    request.sangria = result.data;

    const transaction: SangriaTransaction = {
      hash: result.data.transaction!,
      network: result.data.network!,
      payer: result.data.payer!,
      amount: result.data.amount,
    };

    return handler(request, reply, transaction);
  };
}
