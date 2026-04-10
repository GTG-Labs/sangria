import type {
  SangriaConfig,
  FixedPriceOptions,
  PaymentContext,
  PaymentResult,
  X402ChallengePayload,
} from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:8080";

export class Sangria {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: SangriaConfig) {
    if (!config.apiKey) {
      throw new Error("Sangria: apiKey is required");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private validateFixedPriceOptions(options: FixedPriceOptions): void {
    if (!Number.isFinite(options.price) || options.price <= 0) {
      throw new Error("Sangria: price must be a finite number greater than 0");
    }
  }

  async handleFixedPrice(
    ctx: PaymentContext,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
    this.validateFixedPriceOptions(options);

    if (!ctx.paymentHeader) {
      return this.generatePayment(ctx, options);
    } else {
      return this.settlePayment(ctx.paymentHeader, options);
    }
  }

  // if we dont have a payment header, it means that we need to hit the generate-payment endpoint on our backend,
  // and send the client a 402 response with details on how to pay us
  private async generatePayment(
    ctx: PaymentContext,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
    try {
      const x402_responsePayload = (await this.postToSangriaBackend(
        "/v1/generate-payment",
        {
          amount: options.price,
          resource: ctx.resourceUrl,
          description: options.description,
        }
      )) as X402ChallengePayload;

      // you gotta encode the payload before sending it back (part of the spec)
      const encoded = btoa(JSON.stringify(x402_responsePayload));

      return {
        action: "respond",
        status: 402,
        body: x402_responsePayload,
        headers: { "PAYMENT-REQUIRED": encoded },
      };
    } catch {
      //TODO: instead of doing this, raise an error so the merchant handles it.
      return {
        action: "respond",
        status: 500,
        body: { error: "Payment service unavailable" },
      };
    }
  }

  // there was a payment header so we try to settle the payment
  private async settlePayment(
    paymentHeader: string,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
    try {
      const result = (await this.postToSangriaBackend("/v1/settle-payment", {
        payment_payload: paymentHeader,
      })) as {
        success: boolean;
        transaction?: string;
        error_reason?: string;
        error_message?: string;
      };

      if (!result.success) {
        return {
          action: "respond",
          status: 402,
          body: {
            error: result.error_message ?? "Payment failed",
            error_reason: result.error_reason,
          },
        };
      }

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

  private async postToSangriaBackend(
    path: string,
    body: Record<string, unknown>
  ) {
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
      throw new Error(`Sangria API error (${res.status})`);
    }

    return res.json();
  }
}
