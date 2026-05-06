/**
 * x402-pay setup — checks Keychain, wallet balance, and Permit2 approval status.
 *
 * Usage: tsx setup.ts [--approve]
 *
 * Without --approve: read-only status check.
 * With --approve: also submits a Permit2 USDC approval transaction if needed.
 */

import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  createWalletClient,
  http,
  publicActions,
  parseAbi,
  formatUnits,
  maxUint256,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const KEYCHAIN_SERVICE = "x402-agent-key";
const KEYCHAIN_ACCOUNT = "x402";

function log(msg: string) {
  process.stderr.write(`[setup] ${msg}\n`);
}

function output(data: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      approve: { type: "boolean", default: false },
    },
  });

  // ── 1. Check Keychain ──────────────────────────────────────────────

  log("Checking Keychain for private key...");

  let privateKey: string;
  try {
    privateKey = execSync(
      `security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!privateKey) throw new Error("empty");
  } catch {
    output({
      status: "setup_required",
      step: "keychain",
      message: "Private key not found in macOS Keychain.",
      instructions: [
        "Run this command in your terminal to store your private key securely:",
        "  security add-generic-password -s x402-agent-key -a x402 -U -w",
        "(You will be prompted to enter the key — it won't be displayed)",
        "",
        "The key should be a hex string with 0x prefix (e.g., 0x1234...).",
        "You can export it from CDP using: uv run python playground/agent-test/export-key.py <address>",
      ],
    });
    return;
  }

  log("Key found in Keychain.");

  // ── 2. Build wallet client ─────────────────────────────────────────

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  log(`Wallet address: ${account.address}`);

  // ── 3. Check balances ──────────────────────────────────────────────

  const [ethBalance, usdcBalance, permit2Allowance] = await Promise.all([
    walletClient.getBalance({ address: account.address }),
    walletClient.readContract({
      address: USDC_BASE,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account.address],
    }),
    walletClient.readContract({
      address: USDC_BASE,
      abi: parseAbi([
        "function allowance(address,address) view returns (uint256)",
      ]),
      functionName: "allowance",
      args: [account.address, PERMIT2],
    }),
  ]);

  const ethFormatted = formatEther(ethBalance);
  const usdcFormatted = formatUnits(usdcBalance, 6);
  const permit2Approved = permit2Allowance > 0n;

  log(`ETH balance:  ${ethFormatted}`);
  log(`USDC balance: ${usdcFormatted}`);
  log(`Permit2 approved: ${permit2Approved}`);

  // ── 4. Permit2 approval (if requested) ─────────────────────────────

  if (!permit2Approved && values.approve) {
    if (ethBalance === 0n) {
      output({
        status: "setup_required",
        step: "fund_eth",
        message: "Need ETH for gas to approve Permit2.",
        walletAddress: account.address,
        ethBalance: ethFormatted,
      });
      return;
    }

    log("Submitting Permit2 USDC approval...");
    const hash = await walletClient.writeContract({
      address: USDC_BASE,
      abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
      functionName: "approve",
      args: [PERMIT2, maxUint256],
    });

    log(`Approval tx submitted: ${hash}`);
    const receipt = await walletClient.waitForTransactionReceipt({ hash });
    log(`Confirmed in block ${receipt.blockNumber}`);

    output({
      status: "ready",
      walletAddress: account.address,
      ethBalance: ethFormatted,
      usdcBalance: usdcFormatted,
      permit2Approved: true,
      approvalTxHash: hash,
    });
    return;
  }

  // ── 5. Output status ───────────────────────────────────────────────

  const result: Record<string, unknown> = {
    status: permit2Approved ? "ready" : "setup_required",
    walletAddress: account.address,
    ethBalance: ethFormatted,
    usdcBalance: usdcFormatted,
    permit2Approved,
  };

  if (!permit2Approved) {
    result.step = "permit2";
    result.message =
      "Permit2 is not approved for USDC. Re-run with --approve to submit the approval transaction.";
  }

  output(result);
}

main().catch((err) => {
  output({
    status: "error",
    errorType: "SETUP_FAILED",
    message: err.message,
  });
  process.exit(1);
});
