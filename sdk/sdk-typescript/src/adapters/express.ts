import type { Request, Response, NextFunction } from "express";
import type { SangriaRequestData, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";

export interface ExpressConfig {
  bypassPaymentIf?: (req: Request) => boolean | Promise<boolean>;
}

declare global {
  namespace Express {
    interface Request {
      sangria?: SangriaRequestData;
    }
  }
}

// ── Entry point: add as middleware to gate a route behind payment ──
//
//   app.get("/premium", fixedPrice(sangria, { price: 0.01 }), handler)
//
export function fixedPrice(
  sangria: Sangria,
  options: FixedPriceOptions,
  config?: ExpressConfig
) {
  validateFixedPriceOptions(options);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let shouldBypass = false;
      if (config?.bypassPaymentIf) {
        try {
          // Await handles async callbacks; strict === true rejects Promises/truthy non-booleans.
          const result = await config.bypassPaymentIf(req);
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
        req.sangria = { paid: false, amount: 0 };
        return next();
      }

      const result = await sangria.handleFixedPrice(
        {
          paymentHeader: Array.isArray(req.headers["payment-signature"])
            ? req.headers["payment-signature"][0]
            : req.headers["payment-signature"],
          resourceUrl: `${req.protocol}://${req.hostname}${req.originalUrl}`,
        },
        options
      );

      if (result.action === "respond") {
        if (result.headers) {
          for (const [key, value] of Object.entries(result.headers)) {
            res.setHeader(key, value);
          }
        }
        return res.status(result.status).json(result.body);
      }

      // Attach x402 PAYMENT-RESPONSE header to the outgoing response
      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          res.setHeader(key, value);
        }
      }
      req.sangria = result.data;
      return next();
    } catch (err) {
      // Hand off to Express's error middleware (app.use((err, req, res, next) => ...))
      return next(err);
    }
  };
}

// ── Upto (variable price): wrap a handler to gate it behind payment ──
//
//   app.get("/api/search",
//     uptoPrice(sangria, { maxPrice: 0.10 }, async (req, settle) => {
//       const results = doSearch(req.query.q);
//       return settle(results.length * 0.002, { results });
//     })
//   );
//
export function uptoPrice(
  sangria: Sangria,
  options: UptoPriceOptions,
  handler: (req: Request, settle: SettleFn) => Promise<Settled>,
  config?: ExpressConfig
) {
  validateUptoPriceOptions(options);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let shouldBypass = false;
      if (config?.bypassPaymentIf) {
        try {
          const result = await config.bypassPaymentIf(req);
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
        req.sangria = { paid: false, amount: 0 };
        const { settleFn, getResult } = sangria.createSettleFn("", options.maxPrice);
        await handler(req, settleFn);
        const settleData = getResult();
        return res.json(settleData?.body);
      }

      const paymentHeader = Array.isArray(req.headers["payment-signature"])
        ? req.headers["payment-signature"][0]
        : req.headers["payment-signature"];
      const resourceUrl = `${req.protocol}://${req.hostname}${req.originalUrl}`;

      if (!paymentHeader) {
        const generateResult = await sangria.generateUptoPayment(
          { paymentHeader: undefined, resourceUrl },
          options
        );
        if (generateResult.action === "respond") {
          if (generateResult.headers) {
            for (const [key, value] of Object.entries(generateResult.headers)) {
              res.setHeader(key, value);
            }
          }
          return res.status(generateResult.status).json(generateResult.body);
        }
        throw new Error("Sangria: unexpected generate result");
      }

      const verifyResult = await sangria.verifyPayment(
        paymentHeader,
        toMicrounits(options.maxPrice)
      );
      if (!verifyResult.valid) {
        return res.status(402).json({
          error: verifyResult.message ?? "Payment verification failed",
          error_reason: verifyResult.reason,
        });
      }

      const { settleFn, getResult } = sangria.createSettleFn(paymentHeader, options.maxPrice);

      await handler(req, settleFn);

      const settleData = getResult();
      if (!settleData) {
        throw new Error("Sangria: handler must call settle()");
      }

      const settleResult = await sangria.settleUptoPayment(
        paymentHeader,
        toMicrounits(settleData.amount)
      );

      if (!settleResult.success) {
        return res.status(402).json({
          error: settleResult.error_message ?? "Payment settlement failed",
          error_reason: settleResult.error_reason,
        });
      }

      const paymentResponse = toBase64(JSON.stringify({
        success: true,
        transaction: settleResult.transaction,
        network: settleResult.network,
        payer: settleResult.payer,
      }));
      res.setHeader("PAYMENT-RESPONSE", paymentResponse);

      req.sangria = {
        paid: true,
        amount: settleData.amount,
        transaction: settleResult.transaction,
        network: settleResult.network,
        payer: settleResult.payer,
      };

      return res.json(settleData.body);
    } catch (err) {
      return next(err);
    }
  };
}
