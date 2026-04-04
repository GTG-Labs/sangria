import type {
  SangriaNetConfig,
  FixedPriceOptions,
  PaymentContext,
  PaymentResult,
  PaymentCacheEntry,
} from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:8080";
const CACHE_TTL_MS = 60_000; // 60 seconds, matches backend maxTimeoutSeconds
const CACHE_MAX_SIZE = 1000;

export class SangriaNet {
  private apiKey: string;
  private baseUrl: string;
  private paymentCache: Map<string, PaymentCacheEntry> = new Map();

  constructor(config: SangriaNetConfig) {
    if (!config.apiKey) {
      throw new Error("SangriaNet: apiKey is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  validateFixedPriceOptions(options: FixedPriceOptions): void {
    if (!Number.isFinite(options.price) || options.price <= 0) {
      throw new Error("SangriaNet: price must be a finite number greater than 0");
    }
  }

  async handleFixedPrice(
    ctx: PaymentContext,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
    this.validateFixedPriceOptions(options);

    if (!ctx.paymentHeader) {
      try {
        const terms = (await this.post("/v1/generate-payment", {
          amount: options.price,
          resource: ctx.resourceUrl,
          description: options.description,
        })) as {
          payment_id?: string;
          [key: string]: unknown;
        };

        // Cache payment_id for the settle call
        if (terms.payment_id) {
          this.setCachedPaymentId(ctx.resourceUrl, terms.payment_id);
        }

        return { action: "respond", status: 402, body: terms };
      } catch {
        return {
          action: "respond",
          status: 500,
          body: { error: "Payment service unavailable" },
        };
      }
    }

    // Settle: look up cached payment_id and forward the payment signature
    const paymentId = this.getCachedPaymentId(ctx.resourceUrl);
    if (!paymentId) {
      return {
        action: "respond",
        status: 402,
        body: { error: "Payment session expired, please retry" },
      };
    }

    try {
      const result = (await this.post("/v1/settle-payment", {
        payment_payload: ctx.paymentHeader,
      })) as {
        success: boolean;
        transaction?: string;
        error_message?: string;
      };

      if (!result.success) {
        return {
          action: "respond",
          status: 402,
          body: { error: result.error_message ?? "Payment failed" },
        };
      }

      this.paymentCache.delete(ctx.resourceUrl);

      return {
        action: "proceed",
        data: {
          paid: true,
          amount: options.price,
          transaction: result.transaction,
        },
      };
    } catch {
      return {
        action: "respond",
        status: 500,
        body: { error: "Payment settlement failed" },
      };
    }
  }

  private getCachedPaymentId(resourceUrl: string): string | undefined {
    const entry = this.paymentCache.get(resourceUrl);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.paymentCache.delete(resourceUrl);
      return undefined;
    }
    return entry.paymentId;
  }

  private setCachedPaymentId(resourceUrl: string, paymentId: string): void {
    // Lazy cleanup when cache grows too large
    if (this.paymentCache.size >= CACHE_MAX_SIZE) {
      const now = Date.now();
      for (const [key, val] of this.paymentCache) {
        if (now > val.expiresAt) this.paymentCache.delete(key);
      }
    }
    this.paymentCache.set(resourceUrl, {
      paymentId,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  private async post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`SangriaNet API error (${res.status})`);
    }

    return res.json();
  }
}
