export interface SangriaConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FixedPriceOptions {
  price: number;
  description?: string;
}

export interface SangriaRequestData {
  paid: boolean;
  amount: number;
  transaction?: string;
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
