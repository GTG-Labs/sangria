import type {
  SangriaConfig,
  FixedPriceOptions,
  UptoPriceOptions,
  PaymentContext,
  PaymentResult,
  VerifyResult,
  SettleResult,
  X402ChallengePayload,
  Settled,
  SettleFn,
} from "./types.js";
import { toMicrounits, fromMicrounits, _createSettled, validateUptoPriceOptions } from "./types.js";
import {
  SangriaAPIStatusError,
  SangriaConnectionError,
  SangriaTimeoutError,
  type SangriaOperation,
} from "./errors.js";

const DEFAULT_BASE_URL = "https://api.getsangria.com";

export function toBase64(str: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf-8").toString("base64");
  }
  return btoa(new TextEncoder().encode(str).reduce((s, b) => s + String.fromCharCode(b), ""));
}

export function validateFixedPriceOptions(options: FixedPriceOptions): void {
  if (!Number.isFinite(options.price) || options.price <= 0) {
    throw new Error("Sangria: price must be a positive number (dollars)");
  }
}

export { validateUptoPriceOptions } from "./types.js";

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

  // ── Exact (fixed price) ──────────────────────────────────────────

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

    const encoded = toBase64(JSON.stringify(x402_responsePayload));

    return {
      action: "respond",
      status: 402,
      body: x402_responsePayload,
      headers: { "PAYMENT-REQUIRED": encoded },
    };
  }

  private async settlePayment(
    paymentHeader: string,
    options: FixedPriceOptions
  ): Promise<PaymentResult> {
    const result = (await this.postToSangriaBackend(
      "/v1/settle-payment",
      { payment_payload: paymentHeader },
      "settle"
    )) as SettleResult;

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

    const paymentResponse = toBase64(
      JSON.stringify({
        success: true,
        transaction: result.transaction,
        network: result.network,
        payer: result.payer,
      })
    );

    return {
      action: "proceed",
      data: {
        paid: true,
        amount: options.price,
        transaction: result.transaction,
        network: result.network,
        payer: result.payer,
      },
      headers: { "PAYMENT-RESPONSE": paymentResponse },
    };
  }

  // ── Upto (variable price) ────────────────────────────────────────

  async generateUptoPayment(
    ctx: PaymentContext,
    options: UptoPriceOptions
  ): Promise<PaymentResult> {
    const x402_responsePayload = (await this.postToSangriaBackend(
      "/v1/generate-payment",
      {
        scheme: "upto",
        max_amount: toMicrounits(options.maxPrice),
        resource: ctx.resourceUrl,
        description: options.description,
      },
      "generate"
    )) as X402ChallengePayload;

    const encoded = toBase64(JSON.stringify(x402_responsePayload));

    return {
      action: "respond",
      status: 402,
      body: x402_responsePayload,
      headers: { "PAYMENT-REQUIRED": encoded },
    };
  }

  async verifyPayment(
    paymentHeader: string,
    maxAmountMicrounits: number
  ): Promise<VerifyResult> {
    return (await this.postToSangriaBackend(
      "/v1/verify-payment",
      {
        payment_payload: paymentHeader,
        scheme: "upto",
        max_amount: maxAmountMicrounits,
      },
      "verify"
    )) as VerifyResult;
  }

  async settleUptoPayment(
    paymentHeader: string,
    settlementAmountMicrounits: number
  ): Promise<SettleResult> {
    return (await this.postToSangriaBackend(
      "/v1/settle-payment",
      {
        payment_payload: paymentHeader,
        scheme: "upto",
        settlement_amount: settlementAmountMicrounits,
      },
      "settle"
    )) as SettleResult;
  }

  createSettleFn(
    paymentHeader: string,
    maxPrice: number
  ): { settleFn: SettleFn; getResult: () => { amount: number; body: unknown } | undefined } {
    let called = false;
    let result: { amount: number; body: unknown } | undefined;

    const settleFn: SettleFn = (amount: number, body: unknown): Settled => {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Sangria: settle amount must be a non-negative finite number");
      }
      if (amount > maxPrice) {
        console.warn(
          `[sangria-sdk] settle amount $${amount} exceeds maxPrice $${maxPrice}, clamping to maxPrice`
        );
        amount = maxPrice;
      }
      if (called) {
        return _createSettled(result!.amount, result!.body);
      }
      called = true;
      result = { amount, body };
      return _createSettled(amount, body);
    };

    return { settleFn, getResult: () => result };
  }

  // ── HTTP transport ───────────────────────────────────────────────

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
