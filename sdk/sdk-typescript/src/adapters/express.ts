import type { Request, Response, NextFunction } from "express";
import type { SangriaRequestData, FixedPriceOptions } from "../types.js";
import { SangriaNet } from "../core.js";

export interface ExpressConfig {
  bypassPaymentIf?: (req: Request) => boolean;
}

declare global {
  namespace Express {
    interface Request {
      sangrianet?: SangriaRequestData;
    }
  }
}

// ── Entry point: add as middleware to gate a route behind payment ──
//
//   app.get("/premium", fixedPrice(sangrianet, { price: 0.01 }), handler)
//
export function fixedPrice(
  sangrianet: SangriaNet,
  options: FixedPriceOptions,
  config?: ExpressConfig
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (config?.bypassPaymentIf?.(req)) {
      req.sangrianet = { paid: false, amount: 0 };
      return next();
    }

    const result = await sangrianet.handleFixedPrice(
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

    req.sangrianet = result.data;
    return next();
  };
}
