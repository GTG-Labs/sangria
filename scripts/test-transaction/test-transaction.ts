/**
 * Test Transaction Script
 *
 * Executes a full x402 payment flow via the merchant-nextjs playground server:
 *   1. GET {MERCHANT_URL}/api/premium        → expects 402 + payment requirements
 *   2. Sign EIP-3009 TransferWithAuthorization via CDP SDK
 *   3. GET {MERCHANT_URL}/api/premium        → retry with `payment-signature` header
 *      (merchant server calls Sangria's settle-payment and returns 200)
 *
 * Prerequisites:
 *   Start merchant-nextjs first:
 *     cd playground/merchant-nextjs
 *     SANGRIA_URL=<backend_url> SANGRIA_SECRET_KEY=<api_key> pnpm dev
 *
 * Usage:
 *   cp .env.example .env   # fill in your values
 *   npx tsx test-transaction.ts
 */

import "dotenv/config";
import { CdpClient } from "@coinbase/cdp-sdk";
import { isAddress } from "viem";
import type { Address } from "viem";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const MERCHANT_URL = (
  process.env.MERCHANT_URL ?? "http://localhost:4005"
).replace(/\/+$/, "");
const buyerAddr = requireEnv("BUYER_ADDRESS");
if (!isAddress(buyerAddr)) {
  throw new Error(
    `BUYER_ADDRESS is not a valid Ethereum address: ${buyerAddr}`
  );
}
const BUYER_ADDRESS = buyerAddr as Address;

// ---------------------------------------------------------------------------
// Types matching the x402 spec / Sangria SDK response
// ---------------------------------------------------------------------------

interface PaymentRequirements {
  scheme: string;
  network: string; // "eip155:8453"
  amount: string; // USDC microunits as string
  asset: Address; // USDC contract address
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface X402ChallengeBody {
  x402Version: number;
  accepts: PaymentRequirements[];
  resource?: { url?: string; description?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const premiumUrl = `${MERCHANT_URL}/api/premium`;

  console.log(`\n=== Sangria Test Transaction ===`);
  console.log(`Merchant: ${premiumUrl}`);
  console.log(`Buyer:    ${BUYER_ADDRESS}\n`);

  // ------------------------------------------------------------------
  // Step 1: Hit /api/premium — expect a 402 with payment requirements
  // ------------------------------------------------------------------
  console.log("Step 1: GET /api/premium (expecting 402)...");

  const initialResp = await fetch(premiumUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  console.log(`  Status: ${initialResp.status}`);

  if (initialResp.status !== 402) {
    const body = await initialResp.text();
    throw new Error(`Expected 402, got ${initialResp.status}. Body: ${body}`);
  }

  const challenge = (await initialResp.json()) as X402ChallengeBody;
  const accepts = challenge.accepts?.[0];
  if (!accepts) throw new Error("402 response missing accepts[]");

  console.log(`  Network:  ${accepts.network}`);
  console.log(
    `  Amount:   ${accepts.amount} USDC microunits (${(
      parseInt(accepts.amount) / 1e6
    ).toFixed(6)} USDC)`
  );
  console.log(`  PayTo:    ${accepts.payTo}`);
  console.log(`  Asset:    ${accepts.asset}`);

  // Extract chainId from CAIP-2 string (e.g. "eip155:8453" → 8453)
  const chainIdStr = accepts.network.split(":")[1];
  if (!chainIdStr)
    throw new Error(`Unexpected network format: ${accepts.network}`);
  const chainId = parseInt(chainIdStr, 10);
  if (Number.isNaN(chainId))
    throw new Error(
      `Invalid chainId "${chainIdStr}" in network: ${accepts.network}`
    );

  // ------------------------------------------------------------------
  // Step 2: Sign EIP-3009 TransferWithAuthorization via CDP
  // ------------------------------------------------------------------
  console.log("\nStep 2: Signing EIP-3009 authorization with CDP wallet...");

  const cdp = new CdpClient({
    apiKeyId: requireEnv("CDP_API_KEY_NAME"),
    apiKeySecret: requireEnv("CDP_API_KEY_PRIVATE_KEY"),
    walletSecret: requireEnv("CDP_WALLET_SECRET"),
  });

  const account = await cdp.evm.getAccount({ address: BUYER_ADDRESS });
  console.log(`  Signer:   ${account.address}`);

  const now = Math.floor(Date.now() / 1000);
  const validAfter = BigInt(0);
  const validBefore = BigInt(now + accepts.maxTimeoutSeconds);
  const nonce = randomBytes32();
  const value = BigInt(accepts.amount);

  const signature = await account.signTypedData({
    domain: {
      name: (accepts.extra?.name as string) ?? "USD Coin",
      version: (accepts.extra?.version as string) ?? "2",
      chainId,
      verifyingContract: accepts.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: BUYER_ADDRESS,
      to: accepts.payTo,
      value,
      validAfter,
      validBefore,
      nonce,
    },
  });

  console.log(`  Signature: ${signature.slice(0, 22)}...`);

  // ------------------------------------------------------------------
  // Step 3: Build x402 payload and base64-encode it
  // ------------------------------------------------------------------
  console.log("\nStep 3: Building x402 payload...");

  // x402 v2 payload schema: requirements go under "accepted", not at the top level.
  // CDP facilitator rejects payloads missing the "accepted" key.
  const x402Payload = {
    x402Version: challenge.x402Version,
    accepted: {
      scheme: accepts.scheme,
      network: accepts.network,
      asset: accepts.asset,
      amount: accepts.amount,
      payTo: accepts.payTo,
      maxTimeoutSeconds: accepts.maxTimeoutSeconds,
      extra: accepts.extra,
    },
    payload: {
      signature,
      authorization: {
        from: BUYER_ADDRESS,
        to: accepts.payTo,
        value: Number(accepts.amount),
        validAfter: "0",
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  };

  const payloadB64 = Buffer.from(JSON.stringify(x402Payload)).toString(
    "base64"
  );
  console.log(
    `  Encoded ${JSON.stringify(x402Payload).length} chars → ${
      payloadB64.length
    } base64 chars`
  );

  // ------------------------------------------------------------------
  // Step 4: Retry /api/premium with payment-signature header
  // ------------------------------------------------------------------
  console.log(
    "\nStep 4: GET /api/premium with payment-signature (settling on-chain)..."
  );

  const settleResp = await fetch(premiumUrl, {
    headers: { "payment-signature": payloadB64 },
    signal: AbortSignal.timeout(120_000), // on-chain settlement can take a moment
  });

  console.log(`  Status: ${settleResp.status}`);
  let result: Record<string, unknown>;
  try {
    result = (await settleResp.json()) as Record<string, unknown>;
  } catch {
    const rawText = await settleResp.text();
    result = { rawText, message: "Response body was not valid JSON" };
  }

  // ------------------------------------------------------------------
  // Result
  // ------------------------------------------------------------------
  if (settleResp.status === 200) {
    console.log("\n=== Payment successful! ===");
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error("\n=== Payment failed ===");
    console.error(
      `  HTTP ${settleResp.status}:`,
      JSON.stringify(result, null, 2)
    );
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error("\nFatal error:", err.message ?? err);
  process.exit(1);
});
