import type { Request, Response, NextFunction } from "express";
import type { SangriaRequestData, SangriaTransaction, FixedPriceOptions, UptoPriceOptions, Settled, SettleFn } from "../types.js";
import { toMicrounits } from "../types.js";
import { Sangria, validateFixedPriceOptions, validateUptoPriceOptions, toBase64 } from "../core.js";
import { SangriaHandlerError } from "../errors.js";

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
) {
  validateFixedPriceOptions(options);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
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
) {
  validateUptoPriceOptions(options);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      const { settleFn, getResult } = sangria.createSettleFn(options.maxPrice);

      try {
        await handler(req, settleFn);
      } catch (err) {
        if (err instanceof SangriaHandlerError) {
          return res.status(err.statusCode).json(err.body);
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

// ── Computed price: dynamic exact pricing based on request ──
//
//   app.post("/buy", computedPrice(sangria, calcPrice, async (req, res, transaction) => {
//     res.json({ transactionId: transaction.hash });
//   }));
//
//   calcPrice is called on every request (both the initial 402 and the paid
//   retry). The second call is what detects body tampering — if an attacker
//   replays a signature with a modified body, the recomputed price won't match
//   the signed amount and the request is rejected before settlement.
//
export function computedPrice(
  sangria: Sangria,
  calcPrice: (req: Request) => number | Promise<number>,
  handler: (req: Request, res: Response, transaction: SangriaTransaction) => void | Promise<void>
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const price = await calcPrice(req);

      const result = await sangria.handleFixedPrice(
        {
          paymentHeader: Array.isArray(req.headers["payment-signature"])
            ? req.headers["payment-signature"][0]
            : req.headers["payment-signature"],
          resourceUrl: `${req.protocol}://${req.hostname}${req.originalUrl}`,
        },
        { price }
      );

      if (result.action === "respond") {
        if (result.headers) {
          for (const [key, value] of Object.entries(result.headers)) {
            res.setHeader(key, value);
          }
        }
        return res.status(result.status).json(result.body);
      }

      if (toMicrounits(result.data.amount) !== toMicrounits(price)) {
        return res.status(409).json({
          error: "Price mismatch: settled amount differs from computed price",
        });
      }

      if (result.headers) {
        for (const [key, value] of Object.entries(result.headers)) {
          res.setHeader(key, value);
        }
      }
      req.sangria = result.data;

      const transaction: SangriaTransaction = {
        hash: result.data.transaction!,
        network: result.data.network!,
        payer: result.data.payer!,
        amount: result.data.amount,
      };

      return await handler(req, res, transaction);
    } catch (err) {
      return next(err);
    }
  };
}
