/**
 * Tamper test — verifies that computedPrice rejects body tampering.
 *
 * 1. POST /latte with { quantity: 3 } → get 402 ($0.06)
 * 2. Sign payment for $0.06
 * 3. Replay with TAMPERED body { quantity: 100 } + the $0.06 signature
 * 4. Expected: fresh 402 for $2.00 (pre-settlement check caught mismatch)
 *    NOT: 200 with 100 lattes for $0.06
 */

import "dotenv/config";
import { execSync } from "node:child_process";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const MERCHANT_URL = process.env.MERCHANT_URL ?? "http://localhost:4002";

async function main() {
  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    try {
      privateKey = execSync(
        "security find-generic-password -s x402-agent-key -a x402 -w",
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
    } catch {
      console.error("PRIVATE_KEY env var or Keychain entry (x402-agent-key) required");
      process.exit(1);
    }
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

  const scheme = new ExactEvmScheme(signer);

  console.log("TAMPER TEST — computedPrice body manipulation\n");
  console.log(`Wallet:   ${account.address}`);
  console.log(`Merchant: ${MERCHANT_URL}\n`);

  // Step 1: Request 3 lattes → 402
  console.log("Step 1: POST /latte { quantity: 3 } → expect 402 for $0.06");
  const resp1 = await fetch(`${MERCHANT_URL}/latte`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: 3 }),
  });
  console.log(`  Status: ${resp1.status}`);

  if (resp1.status !== 402) {
    console.log(`  UNEXPECTED: got ${resp1.status}, expected 402`);
    return;
  }

  const paymentRequired = await resp1.json();
  const requirements = paymentRequired.accepts[0];
  const signedAmountMicro = Number(requirements.amount);
  console.log(`  Price: ${signedAmountMicro} microunits ($${signedAmountMicro / 1_000_000})`);

  // Step 2: Sign for $0.06
  console.log("\nStep 2: Sign payment for $0.06");
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
  console.log(`  Signed (${encoded.length} chars)`);

  // Step 3: Replay with TAMPERED body (100 lattes instead of 3)
  console.log("\nStep 3: Replay with TAMPERED body { quantity: 100 } + $0.06 signature");
  console.log("  (attacker wants 100 lattes for the price of 3)");
  const resp2 = await fetch(`${MERCHANT_URL}/latte`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": encoded,
    },
    body: JSON.stringify({ quantity: 100 }),
  });

  console.log(`  Status: ${resp2.status}`);
  const body2 = await resp2.json();
  console.log(`  Body:`, JSON.stringify(body2, null, 4));

  // Verify result
  console.log("\n" + "=".repeat(50));
  if (resp2.status === 402) {
    const newAmount = body2.accepts?.[0]?.amount;
    console.log("PASS: Got fresh 402 — pre-settlement check blocked the tamper.");
    if (newAmount) {
      console.log(`  New price: ${newAmount} microunits ($${Number(newAmount) / 1_000_000})`);
    }
    console.log("  No money was taken. Attack neutralized.");
  } else if (resp2.status === 409) {
    console.log("PARTIAL: Got 409 — post-settlement check caught it,");
    console.log("  but money was already taken (defense-in-depth layer).");
  } else if (resp2.status === 200) {
    console.log("FAIL: Got 200 — attacker got 100 lattes for $0.06!");
    console.log("  The vulnerability is NOT fixed.");
  } else {
    console.log(`UNKNOWN: Got ${resp2.status}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
