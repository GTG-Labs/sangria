/**
 * One-time setup: approve the Permit2 contract to spend USDC on behalf of
 * the buyer wallet. Required before the upto (variable price) scheme works.
 *
 * Usage:
 *   cd playground/agent-test
 *   npx tsx approve-permit2.ts
 */

import "dotenv/config";
import { createWalletClient, http, publicActions, parseAbi, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY env var is required");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http(),
  }).extend(publicActions);

  // Check current allowance
  const allowance = await client.readContract({
    address: USDC_BASE,
    abi: parseAbi(["function allowance(address,address) view returns (uint256)"]),
    functionName: "allowance",
    args: [account.address, PERMIT2],
  });

  console.log(`Wallet:    ${account.address}`);
  console.log(`Allowance: ${allowance} (${Number(allowance) / 1e6} USDC)`);

  if (allowance > 0n) {
    console.log("Already approved — nothing to do.");
    return;
  }

  // Check ETH balance for gas
  const ethBalance = await client.getBalance({ address: account.address });
  console.log(`ETH:       ${Number(ethBalance) / 1e18}`);
  if (ethBalance === 0n) {
    console.error("No ETH for gas — send some ETH to this wallet first.");
    process.exit(1);
  }

  console.log("\nApproving Permit2 for max USDC...");
  const hash = await client.writeContract({
    address: USDC_BASE,
    abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
    functionName: "approve",
    args: [PERMIT2, maxUint256],
  });

  console.log(`TX submitted: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block ${receipt.blockNumber} (status: ${receipt.status})`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
