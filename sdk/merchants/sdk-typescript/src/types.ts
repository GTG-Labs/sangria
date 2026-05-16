export interface SangriaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FixedPriceOptions {
  /** Price in dollars (e.g. 0.01 for one cent). Converted to microunits internally before sending to the backend. */
  price: number;
  description?: string;
  /** How long the agent's signed authorization is valid (seconds). Default: 60. Max: 900. */
  maxTimeoutSeconds?: number;
}

export interface SangriaRequestData {
  paid: boolean;
  /** Amount charged in dollars. */
  amount: number;
  transaction?: string;
  /** CAIP-2 network identifier (e.g. "eip155:8453"). */
  network?: string;
  /** Payer wallet address. */
  payer?: string;
}

/** Number of microunits in 1 USD. */
export const MICROUNITS_PER_DOLLAR = 1_000_000;

/** Convert a dollar amount to microunits. Rounds to nearest integer. */
export function toMicrounits(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error("Sangria: dollars must be a finite number");
  }
  const microunits = Math.round(dollars * MICROUNITS_PER_DOLLAR);
  if (microunits <= 0) {
    throw new Error(
      "Sangria: amount must be a positive integer (microunits)"
    );
  }
  if (microunits > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      "Sangria: amount exceeds Number.MAX_SAFE_INTEGER microunits and cannot be represented safely"
    );
  }
  return microunits;
}

/** Convert microunits to a dollar amount (for display purposes only). */
export function fromMicrounits(microunits: number): number {
  return microunits / MICROUNITS_PER_DOLLAR;
}

export interface UptoPriceOptions {
  /** Maximum price in dollars (e.g. 0.10 for ten cents). The agent authorizes up to this amount. */
  maxPrice: number;
  description?: string;
  /** How long the agent's signed authorization is valid (seconds). Default: 60. Max: 900. */
  maxTimeoutSeconds?: number;
}

export function validateUptoPriceOptions(options: UptoPriceOptions): void {
  if (!Number.isFinite(options.maxPrice) || options.maxPrice <= 0) {
    throw new Error("Sangria: maxPrice must be a positive number (dollars)");
  }
}

/** Opaque x402 challenge payload returned by the payment backend */
export type X402ChallengePayload = Record<string, unknown>;

/** Normalized request context that adapters extract from their framework */
export interface PaymentContext {
  paymentHeader: string | undefined;
  resourceUrl: string;
}

/** Discriminated union returned by core payment logic */
export type PaymentResult =
  | {
      action: "respond";
      status: number;
      body: X402ChallengePayload | { error: string; error_reason?: string };
      headers?: Record<string, string>;
    }
  | { action: "proceed"; data: SangriaRequestData; headers?: Record<string, string> };

/** Result from /v1/verify-payment */
export interface VerifyResult {
  valid: boolean;
  payer?: string;
  reason?: string;
  message?: string;
}

/** Result from /v1/settle-payment */
export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  /** Settled amount in microunits, returned by the backend. */
  amount?: number;
  error_reason?: string;
  error_message?: string;
}

const __settled: unique symbol = Symbol("settled");

/**
 * Branded type returned by the settle function inside uptoPrice handlers.
 * Only the SDK's internal settle function can produce this type, so handlers
 * that forget to call settle() get a compile error.
 */
export type Settled = {
  readonly [__settled]: true;
  readonly __amount: number;
  readonly __body: unknown;
};

/** Creates a Settled value. Internal — not exported to consumers. */
export function _createSettled(amount: number, body: unknown): Settled {
  return { [__settled]: true, __amount: amount, __body: body } as Settled;
}

/** Extracts the amount from a Settled value. Internal. */
export function _settledAmount(s: Settled): number {
  return s.__amount;
}

/** Extracts the body from a Settled value. Internal. */
export function _settledBody(s: Settled): unknown {
  return s.__body;
}

/** The settle function signature passed to upto handlers. */
export type SettleFn = (amount: number, body: unknown) => Settled;

/** Transaction receipt passed to computedPrice handlers after settlement. */
export interface SangriaTransaction {
  /** On-chain transaction hash. */
  hash: string;
  /** CAIP-2 network identifier (e.g. "eip155:8453"). */
  network: string;
  /** Payer wallet address. */
  payer: string;
  /** Amount charged in dollars. */
  amount: number;
}
