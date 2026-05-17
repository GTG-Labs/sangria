/**
 * x402-fetch — makes a signed x402 payment to access a paid API endpoint.
 *
 * Usage: tsx x402-fetch.ts <url> [--method GET|POST] [--body '{}'] [--headers '{}']
 *
 * Reads the private key from macOS Keychain (service: x402-agent-key).
 * Outputs structured JSON to stdout. All diagnostics go to stderr.
 */

import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  createWalletClient,
  http,
  publicActions,
  parseAbi,
  formatUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { UptoEvmScheme } from "@x402/evm/upto/client";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const KEYCHAIN_SERVICE = "x402-agent-key";
const KEYCHAIN_ACCOUNT = "x402";
const MAX_BODY_SIZE = 100_000; // truncate response bodies above 100KB

// ── Helpers ──────────────────────────────────────────────────────────

function log(msg: string) {
  process.stderr.write(`[x402] ${msg}\n`);
}

function output(data: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function fatal(
  errorType: string,
  message: string,
  details?: Record<string, unknown>,
): never {
  output({ status: "error", errorType, message, ...(details && { details }) });
  process.exit(1);
}

function readKeychain(): string {
  try {
    const key = execSync(
      `security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!key) throw new Error("empty");
    return key;
  } catch {
    fatal(
      "KEYCHAIN_ERROR",
      "Private key not found in macOS Keychain. Run the setup flow first.",
      {
        hint: "Ask the user to run: ! security add-generic-password -s x402-agent-key -a x402 -U -w",
      },
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      method: { type: "string", short: "m", default: "GET" },
      body: { type: "string", short: "b" },
      headers: { type: "string", short: "H" },
    },
  });

  const url = positionals[0];
  if (!url) {
    fatal("INVALID_ARGS", "Usage: x402-fetch <url> [--method GET|POST] [--body '{}'] [--headers '{}']");
  }

  const method = (values.method ?? "GET").toUpperCase();
  const extraHeaders: Record<string, string> = values.headers
    ? JSON.parse(values.headers)
    : {};
  const bodyPayload = values.body ?? undefined;

  // ── 1. Read key from Keychain ──────────────────────────────────────

  log("Reading private key from Keychain...");
  const privateKey = readKeychain();

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

  log(`Wallet: ${account.address}`);

  // ── 2. Initial request ─────────────────────────────────────────────

  log(`${method} ${url}`);

  let resp1: Response;
  try {
    resp1 = await fetch(url, {
      method,
      headers: {
        ...(bodyPayload ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: bodyPayload,
    });
  } catch (err: any) {
    fatal("NETWORK_ERROR", `Failed to reach ${url}: ${err.message}`, {
      url,
    });
  }

  // Not a 402 — return the response as-is
  if (resp1.status !== 402) {
    const text = await resp1.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text.length > MAX_BODY_SIZE ? text.slice(0, MAX_BODY_SIZE) : text;
    }
    output({
      status: "no_payment_required",
      httpStatus: resp1.status,
      body,
    });
    return;
  }

  // ── 3. Parse 402 payment requirements ──────────────────────────────

  log("Got 402 — parsing payment requirements...");

  let paymentRequired: any;

  // x402 v2: requirements come in the `payment-required` header (base64 JSON)
  const paymentRequiredHeader = resp1.headers.get("payment-required");
  if (paymentRequiredHeader) {
    try {
      paymentRequired = JSON.parse(atob(paymentRequiredHeader));
    } catch {
      fatal("PAYMENT_REJECTED", "Could not decode payment-required header");
    }
  } else {
    // Fallback: parse from response body (Sangria-style)
    try {
      paymentRequired = await resp1.json();
    } catch {
      fatal("PAYMENT_REJECTED", "402 response did not contain valid JSON payment requirements");
    }
  }

  if (!paymentRequired.accepts?.length) {
    fatal("PAYMENT_REJECTED", "402 response has no accepted payment methods", {
      body: paymentRequired,
    });
  }

  const requirements = paymentRequired.accepts[0];

  // Normalize: backend sends maxAmountRequired for upto, x402 client expects amount
  if (!requirements.amount && requirements.maxAmountRequired) {
    requirements.amount = requirements.maxAmountRequired;
  }

  const scheme = requirements.scheme ?? "exact";
  const amountMicro = parseInt(requirements.amount ?? "0", 10);
  const amountUSD = (amountMicro / 1_000_000).toFixed(6);

  log(`Scheme: ${scheme} | Amount: ${amountMicro} microunits ($${amountUSD}) | Network: ${requirements.network}`);

  // ── 4. Pre-flight checks ───────────────────────────────────────────

  try {
    const balance = await walletClient.readContract({
      address: USDC_BASE,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account.address],
    });

    const balanceMicro = Number(balance);
    log(`USDC balance: ${formatUnits(balance, 6)} USDC`);

    if (balanceMicro < amountMicro) {
      fatal("INSUFFICIENT_BALANCE", `USDC balance too low: have ${formatUnits(balance, 6)}, need ${amountUSD}`, {
        walletAddress: account.address,
        balanceUSDC: formatUnits(balance, 6),
        requiredUSDC: amountUSD,
      });
    }
  } catch (err: any) {
    if (err.errorType) throw err; // re-throw our own fatal errors
    log(`Warning: could not check balance (${err.message}). Proceeding anyway.`);
  }

  // For upto scheme, check Permit2 allowance
  if (scheme === "upto") {
    try {
      const allowance = await walletClient.readContract({
        address: USDC_BASE,
        abi: parseAbi([
          "function allowance(address,address) view returns (uint256)",
        ]),
        functionName: "allowance",
        args: [account.address, PERMIT2],
      });

      if (allowance === 0n) {
        fatal("PERMIT2_NOT_APPROVED", "USDC is not approved for Permit2. Run the setup script to approve.", {
          walletAddress: account.address,
          permit2Address: PERMIT2,
          hint: "Run setup.ts to approve Permit2",
        });
      }
      log(`Permit2 allowance: ${formatUnits(allowance, 6)} USDC`);
    } catch (err: any) {
      if (err.errorType) throw err;
      log(`Warning: could not check Permit2 allowance (${err.message}). Proceeding anyway.`);
    }
  }

  // ── 5. Sign payment ────────────────────────────────────────────────

  log(`Signing ${scheme} payment...`);

  let payloadResult: any;
  try {
    const schemeClient =
      scheme === "upto" ? new UptoEvmScheme(signer) : new ExactEvmScheme(signer);

    payloadResult = await schemeClient.createPaymentPayload(
      paymentRequired.x402Version ?? 2,
      requirements,
      paymentRequired.extensions
        ? { extensions: paymentRequired.extensions }
        : undefined,
    );
  } catch (err: any) {
    fatal("SIGNING_FAILED", `Failed to sign payment: ${err.message}`);
  }

  const fullPayload = {
    x402Version: payloadResult.x402Version,
    payload: payloadResult.payload,
    accepted: requirements,
  };
  const encoded = btoa(JSON.stringify(fullPayload));
  log(`Payment signed (${encoded.length} chars)`);

  // ── 6. Retry with payment signature ────────────────────────────────

  log(`Retrying ${method} ${url} with PAYMENT-SIGNATURE...`);

  let resp2: Response;
  try {
    resp2 = await fetch(url, {
      method,
      headers: {
        "PAYMENT-SIGNATURE": encoded,
        ...(bodyPayload ? { "Content-Type": "application/json" } : {}),
        ...extraHeaders,
      },
      body: bodyPayload,
    });
  } catch (err: any) {
    fatal("NETWORK_ERROR", `Retry request failed: ${err.message}`, { url });
  }

  // ── 7. Parse response ──────────────────────────────────────────────

  const text2 = await resp2.text();
  let body2: unknown;
  let bodyTruncated = false;
  try {
    body2 = JSON.parse(text2);
  } catch {
    if (text2.length > MAX_BODY_SIZE) {
      body2 = text2.slice(0, MAX_BODY_SIZE);
      bodyTruncated = true;
    } else {
      body2 = text2;
    }
  }

  // Parse settlement info from payment-response header
  let settlement: Record<string, unknown> | null = null;
  const paymentResponseHeader = resp2.headers.get("payment-response");
  if (paymentResponseHeader) {
    try {
      settlement = JSON.parse(atob(paymentResponseHeader)) as Record<string, unknown>;
    } catch {
      settlement = { raw: paymentResponseHeader };
    }
  }

  if (resp2.status >= 200 && resp2.status < 300) {
    log(`Payment successful (${resp2.status})`);
    output({
      status: "success",
      httpStatus: resp2.status,
      body: body2,
      ...(bodyTruncated && { bodyTruncated: true }),
      ...(settlement && { settlement }),
      payment: {
        scheme,
        amountMicro,
        amountUSD,
      },
    });
  } else {
    log(`Payment failed (${resp2.status})`);
    output({
      status: "error",
      errorType: "PAYMENT_REJECTED",
      message: `Server returned ${resp2.status} after payment`,
      details: {
        httpStatus: resp2.status,
        body: body2,
        ...(settlement && { settlement }),
      },
    });
  }
}

main().catch((err) => {
  if (err.errorType) process.exit(1); // already handled by fatal()
  fatal("UNEXPECTED", `Unexpected error: ${err.message}`);
});
