export interface SangriaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FixedPriceOptions {
  /** Price in microunits (1 USD = 1_000_000 microunits). Must be a positive integer. */
  price: number;
  description?: string;
}

export interface SangriaRequestData {
  paid: boolean;
  /** Amount charged in microunits (1 USD = 1_000_000 microunits). */
  amount: number;
  transaction?: string;
}

/** Number of microunits in 1 USD. */
export const MICROUNITS_PER_DOLLAR = 1_000_000;

/** Convert a dollar amount to microunits. Rounds to nearest integer. */
export function toMicrounits(dollars: number): number {
  return Math.round(dollars * MICROUNITS_PER_DOLLAR);
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
