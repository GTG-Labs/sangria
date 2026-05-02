export interface SangriaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FixedPriceOptions {
  /** Price in dollars (e.g. 0.01 for one cent). Converted to microunits internally before sending to the backend. */
  price: number;
  description?: string;
}

export interface SangriaRequestData {
  paid: boolean;
  /** Amount charged in dollars. */
  amount: number;
  transaction?: string;
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
    throw new Error("Sangria: amount must be a positive integer (microunits)");
  }
  if (microunits > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      "Sangria: amount exceeds Number.MAX_SAFE_INTEGER microunits and cannot be represented safely",
    );
  }
  return microunits;
}

/** Convert microunits to a dollar amount (for display purposes only). */
export function fromMicrounits(microunits: number): number {
  return microunits / MICROUNITS_PER_DOLLAR;
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
  | { action: "proceed"; data: SangriaRequestData };
