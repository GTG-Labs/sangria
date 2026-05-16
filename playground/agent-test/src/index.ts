/**
 * Agent test client — acts as the buyer/agent side of x402 payments.
 *
 * Tests both exact (fixed price) and upto (variable price) payment flows
 * against any of the playground merchant servers.
 *
 * Usage:
 *   pnpm test          # run both exact + upto
 *   pnpm test:exact    # exact only (/premium)
 *   pnpm test:upto     # upto only (/api/search)
 */

import "dotenv/config";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { UptoEvmScheme } from "@x402/evm/upto/client";

const MERCHANT_URL = process.env.MERCHANT_URL ?? "http://localhost:4001";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Error: PRIVATE_KEY env var is required (hex with 0x prefix)");
    console.error("See .env.example for setup instructions.");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  const signer = toClientEvmSigner(
    {
      address: account.address,
      signTypedData: (msg) => walletClient.signTypedData(msg as any),
    },
    walletClient as any,
  );

  console.log(`Agent wallet: ${account.address}`);
  console.log(`Merchant:     ${MERCHANT_URL}\n`);

  // Sanity check: make sure the merchant is reachable
  try {
    const resp = await fetch(`${MERCHANT_URL}/`);
    const text = await resp.text();
    try {
      console.log(`GET / → ${resp.status}`, JSON.parse(text));
    } catch {
      console.log(`GET / → ${resp.status} (HTML page)`);
    }
  } catch (err) {
    console.error(`Cannot reach ${MERCHANT_URL} — is the merchant server running?`);
    process.exit(1);
  }

  const mode = process.argv[2] ?? "all";

  if (mode === "exact" || mode === "all") {
    await testExact(signer);
  }
  if (mode === "upto" || mode === "all") {
    await testUpto(signer);
  }
  if (mode === "computed" || mode === "all") {
    await testComputed(signer);
  }

  console.log("\nDone.");
}

// ── Exact scheme test (/premium, $0.01) ───────────────────────────

async function testExact(signer: ReturnType<typeof toClientEvmSigner>) {
  console.log("\n" + "=".repeat(60));
  console.log("EXACT SCHEME — GET /premium ($0.01 fixed)");
  console.log("=".repeat(60));

  const scheme = new ExactEvmScheme(signer);

  // Step 1: Hit endpoint → expect 402
  console.log("\n→ Step 1: Request resource");
  const resp1 = await fetch(`${MERCHANT_URL}/premium`);
  console.log(`  Status: ${resp1.status}`);

  if (resp1.status !== 402) {
    console.log(`  Expected 402, got ${resp1.status}. Stopping.`);
    console.log(`  Body:`, await resp1.text());
    return;
  }

  const paymentRequired = await resp1.json();
  const requirements = paymentRequired.accepts[0];
  console.log(`  Scheme:  ${requirements.scheme}`);
  console.log(`  Amount:  ${requirements.amount} microunits`);
  console.log(`  Network: ${requirements.network}`);
  console.log(`  PayTo:   ${requirements.payTo}`);

  // Step 2: Sign payment
  console.log("\n→ Step 2: Sign payment (EIP-3009 / Permit2)");
  const payloadResult = await scheme.createPaymentPayload(
    paymentRequired.x402Version ?? 2,
    requirements,
    paymentRequired.extensions ? { extensions: paymentRequired.extensions } : undefined,
  );

  const fullPayload = {
    x402Version: payloadResult.x402Version,
    payload: payloadResult.payload,
    accepted: requirements,
  };
  const encoded = btoa(JSON.stringify(fullPayload));
  console.log(`  Payload encoded (${encoded.length} chars)`);

  // Step 3: Retry with signed payment
  console.log("\n→ Step 3: Retry with PAYMENT-SIGNATURE");
  const resp2 = await fetch(`${MERCHANT_URL}/premium`, {
    headers: { "PAYMENT-SIGNATURE": encoded },
  });
  console.log(`  Status: ${resp2.status}`);

  const text2 = await resp2.text();
  let body2: any;
  try {
    body2 = JSON.parse(text2);
    console.log(`  Body:`, JSON.stringify(body2, null, 4));
  } catch {
    console.log(`  Body (raw):`, text2.slice(0, 500));
  }

  const paymentResponse = resp2.headers.get("payment-response");
  if (paymentResponse) {
    console.log(`  Settlement:`, JSON.parse(atob(paymentResponse)));
  }
}

// ── Upto scheme test (/api/search, up to $0.10) ──────────────────

async function testUpto(signer: ReturnType<typeof toClientEvmSigner>) {
  console.log("\n" + "=".repeat(60));
  console.log("UPTO SCHEME — GET /api/search?q=test (up to $0.10)");
  console.log("=".repeat(60));

  const scheme = new UptoEvmScheme(signer);

  // Step 1: Hit endpoint → expect 402
  console.log("\n→ Step 1: Request resource");
  const resp1 = await fetch(`${MERCHANT_URL}/api/search?q=test`);
  console.log(`  Status: ${resp1.status}`);

  if (resp1.status !== 402) {
    console.log(`  Expected 402, got ${resp1.status}. Stopping.`);
    console.log(`  Body:`, await resp1.text());
    return;
  }

  const paymentRequired = await resp1.json();
  const requirements = paymentRequired.accepts[0];

  // x402 V2 uses 'amount' for both schemes; our backend sends
  // 'maxAmountRequired' for upto. Normalize for the x402 client.
  if (!requirements.amount && requirements.maxAmountRequired) {
    requirements.amount = requirements.maxAmountRequired;
  }

  console.log(`  Scheme:     ${requirements.scheme}`);
  console.log(`  Max amount: ${requirements.maxAmountRequired ?? requirements.amount} microunits`);
  console.log(`  Network:    ${requirements.network}`);
  console.log(`  PayTo:      ${requirements.payTo}`);

  // Step 2: Sign Permit2 payload
  console.log("\n→ Step 2: Sign Permit2 payload");
  const payloadResult = await scheme.createPaymentPayload(
    paymentRequired.x402Version ?? 2,
    requirements,
    paymentRequired.extensions ? { extensions: paymentRequired.extensions } : undefined,
  );

  const fullPayload = {
    x402Version: payloadResult.x402Version,
    payload: payloadResult.payload,
    accepted: requirements,
  };
  const encoded = btoa(JSON.stringify(fullPayload));
  console.log(`  Payload encoded (${encoded.length} chars)`);

  // Step 3: Retry with signed payment
  console.log("\n→ Step 3: Retry with PAYMENT-SIGNATURE");
  const resp2 = await fetch(`${MERCHANT_URL}/api/search?q=test`, {
    headers: { "PAYMENT-SIGNATURE": encoded },
  });
  console.log(`  Status: ${resp2.status}`);

  const text2 = await resp2.text();
  let body2: any;
  try {
    body2 = JSON.parse(text2);
    console.log(`  Body:`, JSON.stringify(body2, null, 4));
  } catch {
    console.log(`  Body (raw):`, text2.slice(0, 500));
  }

  const paymentResponse = resp2.headers.get("payment-response");
  if (paymentResponse) {
    console.log(`  Settlement:`, JSON.parse(atob(paymentResponse)));
  }

  if (resp2.status === 200 && body2?.cost !== undefined) {
    console.log(`\n  Charged: $${body2.cost} (${body2.results?.length ?? 0} results)`);
  }
}

// ── Computed price test (POST /latte, $0.02 per latte) ──────────

async function testComputed(signer: ReturnType<typeof toClientEvmSigner>) {
  console.log("\n" + "=".repeat(60));
  console.log("COMPUTED PRICE — POST /latte (3 lattes × $0.02 = $0.06)");
  console.log("=".repeat(60));

  const scheme = new ExactEvmScheme(signer);
  const body = JSON.stringify({ quantity: 3 });

  // Step 1: Hit endpoint → expect 402 with computed price
  console.log("\n→ Step 1: Request lattes");
  const resp1 = await fetch(`${MERCHANT_URL}/latte`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  console.log(`  Status: ${resp1.status}`);

  if (resp1.status !== 402) {
    console.log(`  Expected 402, got ${resp1.status}. Stopping.`);
    console.log(`  Body:`, await resp1.text());
    return;
  }

  const paymentRequired = await resp1.json();
  const requirements = paymentRequired.accepts[0];
  console.log(`  Scheme:  ${requirements.scheme}`);
  console.log(`  Amount:  ${requirements.amount} microunits ($${Number(requirements.amount) / 1_000_000})`);
  console.log(`  Network: ${requirements.network}`);

  // Step 2: Sign payment
  console.log("\n→ Step 2: Sign payment");
  const payloadResult = await scheme.createPaymentPayload(
    paymentRequired.x402Version ?? 2,
    requirements,
    paymentRequired.extensions ? { extensions: paymentRequired.extensions } : undefined,
  );

  const fullPayload = {
    x402Version: payloadResult.x402Version,
    payload: payloadResult.payload,
    accepted: requirements,
  };
  const encoded = btoa(JSON.stringify(fullPayload));
  console.log(`  Payload encoded (${encoded.length} chars)`);

  // Step 3: Retry with same body + signed payment
  console.log("\n→ Step 3: Retry with PAYMENT-SIGNATURE (same body)");
  const resp2 = await fetch(`${MERCHANT_URL}/latte`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": encoded,
    },
    body,
  });
  console.log(`  Status: ${resp2.status}`);

  const text2 = await resp2.text();
  let body2: any;
  try {
    body2 = JSON.parse(text2);
    console.log(`  Body:`, JSON.stringify(body2, null, 4));
  } catch {
    console.log(`  Body (raw):`, text2.slice(0, 500));
  }

  const paymentResponse = resp2.headers.get("payment-response");
  if (paymentResponse) {
    console.log(`  Settlement:`, JSON.parse(atob(paymentResponse)));
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
