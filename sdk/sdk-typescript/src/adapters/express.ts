import type { Request, Response, NextFunction } from "express";
import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { Sangria, validateFixedPriceOptions } from "../core.js";

export interface ExpressConfig {
  bypassPaymentIf?: (req: Request) => boolean;
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
      if (config?.bypassPaymentIf?.(req)) {
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

      req.sangria = result.data;
      return next();
    } catch (err) {
      // Hand off to Express's error middleware (app.use((err, req, res, next) => ...))
      return next(err);
    }
  };
}
