import type {
  SangriaConfig,
  FixedPriceOptions,
  PaymentContext,
  PaymentResult,
  X402ChallengePayload,
} from "./types.js";
import { toMicrounits } from "./types.js";
import {
  SangriaAPIStatusError,
  SangriaConnectionError,
  SangriaTimeoutError,
  type SangriaOperation,
} from "./errors.js";

const DEFAULT_BASE_URL = "https://api.getsangria.com";

export function validateFixedPriceOptions(options: FixedPriceOptions): void {
  if (!Number.isFinite(options.price) || options.price <= 0) {
    throw new Error("Sangria: price must be a positive number (dollars)");
  }
}

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

  async handleFixedPrice(
    ctx: PaymentContext,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
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
    const x402_responsePayload = (await this.postToSangriaBackend(
      "/v1/generate-payment",
      {
        amount: toMicrounits(options.price),
        resource: ctx.resourceUrl,
        description: options.description,
      },
      "generate"
    )) as X402ChallengePayload;

    // you gotta encode the payload before sending it back (part of the spec)
    const encoded = btoa(JSON.stringify(x402_responsePayload));

    return {
      action: "respond",
      status: 402,
      body: x402_responsePayload,
      headers: { "PAYMENT-REQUIRED": encoded },
    };
  }

  // there was a payment header so we try to settle the payment
  private async settlePayment(
    paymentHeader: string,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
    const result = (await this.postToSangriaBackend(
      "/v1/settle-payment",
      { payment_payload: paymentHeader },
      "settle"
    )) as {
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
  }

  private async postToSangriaBackend(
    path: string,
    body: Record<string, unknown>,
    operation: SangriaOperation
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    };

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new SangriaTimeoutError(
          "Sangria request timed out after 8000ms",
          { operation, cause: err }
        );
      }
      throw new SangriaConnectionError(
        err instanceof Error ? err.message : "Sangria connection failed",
        { operation, cause: err }
      );
    }

    if (!res.ok) {
      const message = await parseErrorMessage(res.clone());
      throw new SangriaAPIStatusError(message, {
        operation,
        response: res,
        statusCode: res.status,
      });
    }

    try {
      return await res.clone().json();
    } catch (err) {
      throw new SangriaAPIStatusError(
        "Sangria returned a malformed response body",
        { operation, response: res, statusCode: res.status, cause: err }
      );
    }
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as Record<string, unknown> | null | undefined;
      const errorObj = body?.["error"] as Record<string, unknown> | null | undefined;
      const nestedMsg = errorObj?.["message"];
      const topMsg = body?.["message"];
      const stringError = typeof body?.["error"] === "string" ? (body["error"] as string) : undefined;
      const msg =
        (typeof nestedMsg === "string" ? nestedMsg : undefined) ??
        (typeof topMsg === "string" ? topMsg : undefined) ??
        stringError;
      if (typeof msg === "string" && msg.length > 0) {
        return msg;
      }
    } catch {
      // not JSON — fall through
    }
    if (text.length > 0) return text;
  } catch {
    // body read failed
  }
  return `HTTP ${response.status}`;
}
