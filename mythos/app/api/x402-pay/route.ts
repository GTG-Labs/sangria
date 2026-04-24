import { CdpClient } from "@coinbase/cdp-sdk";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type {
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";
import { withAuth } from "@workos-inc/authkit-nextjs";
import type { Address } from "viem";
import { isAddress } from "viem";
import { verifyAdmin } from "@/lib/admin";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BACKEND_URL = (
  process.env.BACKEND_URL ?? "http://localhost:8080"
).replace(/\/+$/, "");
const MYTHOS_BASE_URL = (
  process.env.MYTHOS_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");
const DEMO_PRICE_MICROUNITS = 100;
const MICROUNITS_PER_USDC = BigInt(1_000_000);
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const MIN_IDEMPOTENCY_KEY_LENGTH = 8;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const SWEEP_EVERY_N_REQUESTS = 50;

const paymentRateLimitStore = new Map<
  string,
  { windowStart: number; count: number }
>();
const idempotencyStore = new Map<
  string,
  { status: "in_flight" | "completed" | "unresolved"; expiresAt: number }
>();
let requestCounter = 0;

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BackendGeneratePaymentResponse {
  x402Version: number;
  accepts: PaymentRequirements[];
  resource?: ResourceInfo;
}

interface SignedPayloadPreview {
  payload?: {
    signature?: string;
    authorization?: {
      from?: Address;
    };
  };
}

interface SseEvent {
  step: "negotiate" | "sign" | "settle" | "error";
  status: "pending" | "done" | "error";
  data?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encode(event: SseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function toPaymentRequired(
  response: BackendGeneratePaymentResponse,
  fallbackResource: string
): PaymentRequired {
  if (response.x402Version !== 2) {
    throw new Error(
      `Expected x402Version=2 from generate-payment, received ${response.x402Version}`
    );
  }
  if (!response.accepts?.length) {
    throw new Error("402 response missing accepts[]");
  }

  return {
    x402Version: 2,
    accepts: response.accepts,
    resource: {
      url: response.resource?.url ?? fallbackResource,
      description:
        response.resource?.description ?? "Access premium newspaper content",
      mimeType: response.resource?.mimeType ?? "application/json",
    },
  };
}

function cleanupStateStores(now: number): void {
  for (const [key, entry] of paymentRateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      paymentRateLimitStore.delete(key);
    }
  }
  for (const [key, entry] of idempotencyStore) {
    if (now > entry.expiresAt) {
      idempotencyStore.delete(key);
    }
  }
}

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  requestCounter += 1;
  if (requestCounter % SWEEP_EVERY_N_REQUESTS === 0) {
    cleanupStateStores(now);
  }

  const entry = paymentRateLimitStore.get(userId);
  if (entry && now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    paymentRateLimitStore.delete(userId);
  }
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    paymentRateLimitStore.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  entry.count += 1;
  return true;
}

function reserveIdempotency(
  userId: string,
  idempotencyKey: string
):
  | { ok: true; storeKey: string }
  | { ok: false; status: "in_flight" | "completed" | "unresolved" } {
  const now = Date.now();
  requestCounter += 1;
  if (requestCounter % SWEEP_EVERY_N_REQUESTS === 0) {
    cleanupStateStores(now);
  }

  const storeKey = `${userId}:${idempotencyKey}`;
  const existing = idempotencyStore.get(storeKey);
  if (existing && now > existing.expiresAt) {
    idempotencyStore.delete(storeKey);
  }
  if (existing && now <= existing.expiresAt) {
    return { ok: false, status: existing.status };
  }

  idempotencyStore.set(storeKey, {
    status: "in_flight",
    expiresAt: now + IDEMPOTENCY_TTL_MS,
  });
  return { ok: true, storeKey };
}

function markIdempotencyCompleted(storeKey: string): void {
  idempotencyStore.set(storeKey, {
    status: "completed",
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

function markIdempotencyUnresolved(storeKey: string): void {
  idempotencyStore.set(storeKey, {
    status: "unresolved",
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

function releaseIdempotency(storeKey: string): void {
  idempotencyStore.delete(storeKey);
}

// ---------------------------------------------------------------------------
// POST /api/x402-pay  — Server-Sent Events payment flow
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const { user, accessToken } = await withAuth();
  if (!user || !accessToken) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const isAdmin = await verifyAdmin(accessToken);
  if (!isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (
    !idempotencyKey ||
    idempotencyKey.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return Response.json(
      { error: "Missing or invalid x-idempotency-key header" },
      { status: 400 }
    );
  }

  const idempotencyReservation = reserveIdempotency(user.id, idempotencyKey);
  if (!idempotencyReservation.ok) {
    const duplicateMessage =
      idempotencyReservation.status === "unresolved"
        ? "A prior settlement attempt with this idempotency key is unresolved. Please use a new payment attempt."
        : "Duplicate payment attempt detected for idempotency key";
    return Response.json({ error: duplicateMessage }, { status: 409 });
  }
  const { storeKey: idempotencyStoreKey } = idempotencyReservation;

  if (!checkRateLimit(user.id)) {
    releaseIdempotency(idempotencyStoreKey);
    return Response.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const send = (event: SseEvent) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encode(event));
        } catch {
          streamClosed = true;
        }
      };
      let completed = false;
      let settlementAttempted = false;

      try {
        const merchantApiKey = requireEnv("SANGRIA_SECRET_KEY");
        const buyerAddrRaw = requireEnv("BUYER_ADDRESS");
        if (!isAddress(buyerAddrRaw)) {
          throw new Error(`BUYER_ADDRESS is not a valid Ethereum address`);
        }
        const BUYER_ADDRESS = buyerAddrRaw as Address;
        const generatePaymentUrl = `${BACKEND_URL}/v1/generate-payment`;
        const settlePaymentUrl = `${BACKEND_URL}/v1/settle-payment`;
        const demoResource = `${MYTHOS_BASE_URL}/newspaper`;
        const negotiateSignal = AbortSignal.any([
          request.signal,
          AbortSignal.timeout(15_000),
        ]);

        // ----------------------------------------------------------------
        // Step 1: Negotiate — ask Sangria backend for payment requirements
        // ----------------------------------------------------------------
        send({ step: "negotiate", status: "pending" });

        const initialResp = await fetch(generatePaymentUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${merchantApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: DEMO_PRICE_MICROUNITS,
            description: "Access premium newspaper content",
            resource: demoResource,
          }),
          signal: negotiateSignal,
        });

        if (initialResp.status !== 200) {
          const body = await initialResp.text();
          throw new Error(
            `Expected 200 from generate-payment, got ${initialResp.status}. Body: ${body}`
          );
        }

        const challenge =
          (await initialResp.json()) as BackendGeneratePaymentResponse;
        const paymentRequired = toPaymentRequired(challenge, demoResource);
        const accepts = paymentRequired.accepts[0];
        if (!accepts) throw new Error("payment requirements missing accepts[]");
        const amountMicro = BigInt(accepts.amount);
        if (amountMicro !== BigInt(DEMO_PRICE_MICROUNITS)) {
          throw new Error(
            "Negotiated amount does not match configured demo price"
          );
        }
        const wholePart = amountMicro / MICROUNITS_PER_USDC;
        const fractionalPart = (amountMicro % MICROUNITS_PER_USDC)
          .toString()
          .padStart(6, "0");
        const amountUsdc = `${wholePart}.${fractionalPart}`;

        send({
          step: "negotiate",
          status: "done",
          data: {
            amount: accepts.amount,
            amountUsdc,
            payTo: accepts.payTo,
            asset: accepts.asset,
            network: accepts.network,
          },
        });

        // ----------------------------------------------------------------
        // Step 2: Sign — EIP-3009 TransferWithAuthorization via CDP
        // ----------------------------------------------------------------
        send({ step: "sign", status: "pending" });

        const cdp = new CdpClient({
          apiKeyId: requireEnv("CDP_API_KEY_NAME"),
          apiKeySecret: requireEnv("CDP_API_KEY_PRIVATE_KEY"),
          walletSecret: requireEnv("CDP_WALLET_SECRET"),
        });

        const account = await cdp.evm.getAccount({ address: BUYER_ADDRESS });
        const signer: ClientEvmSigner = {
          address: account.address as Address,
          signTypedData: account.signTypedData.bind(account),
        };

        const client = new x402Client().register(
          "eip155:*",
          new ExactEvmScheme(signer)
        );
        const httpClient = new x402HTTPClient(client);
        const paymentPayload = await httpClient.createPaymentPayload(
          paymentRequired
        );
        const signatureHeaders =
          httpClient.encodePaymentSignatureHeader(paymentPayload);
        const paymentSignature = signatureHeaders["PAYMENT-SIGNATURE"];
        if (!paymentSignature) {
          throw new Error(
            "x402 v2 client did not return PAYMENT-SIGNATURE header"
          );
        }

        const signedPreview = JSON.parse(
          Buffer.from(paymentSignature, "base64").toString("utf8")
        ) as SignedPayloadPreview;
        const signature = signedPreview.payload?.signature;
        if (!signature) {
          throw new Error("x402 v2 client returned payload without signature");
        }

        send({
          step: "sign",
          status: "done",
          data: {
            signer:
              signedPreview.payload?.authorization?.from ?? account.address,
            signaturePreview: signature.slice(0, 22) + "...",
          },
        });

        // ----------------------------------------------------------------
        // Step 3: Build x402 payload and settle
        // ----------------------------------------------------------------
        send({ step: "settle", status: "pending" });

        settlementAttempted = true;
        const settleResp = await fetch(settlePaymentUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${merchantApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payment_payload: paymentSignature,
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (settleResp.status !== 200) {
          let errBody: unknown;
          try {
            errBody = await settleResp.json();
          } catch {
            errBody = await settleResp.text();
          }
          throw new Error(
            `Settlement failed (HTTP ${settleResp.status}): ${JSON.stringify(
              errBody
            )}`
          );
        }

        const result = (await settleResp.json()) as Record<string, unknown>;

        send({
          step: "settle",
          status: "done",
          data: { result },
        });
        completed = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ step: "error", status: "error", error: message });
      } finally {
        if (completed) {
          markIdempotencyCompleted(idempotencyStoreKey);
        } else if (settlementAttempted) {
          markIdempotencyUnresolved(idempotencyStoreKey);
        } else {
          releaseIdempotency(idempotencyStoreKey);
        }
        if (!streamClosed) {
          streamClosed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, max-age=0",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
