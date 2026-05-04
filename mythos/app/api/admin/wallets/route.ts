import { CdpClient } from "@coinbase/cdp-sdk";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { verifyAdmin } from "@/lib/admin";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVM_NETWORKS = ["base", "base-sepolia"] as const;
const SOLANA_NETWORKS = ["solana", "solana-devnet"] as const;

interface TokenBalance {
  token: string;
  symbol: string;
  amount: string;
  decimals: number;
  contractAddress: string;
}

interface WalletAccount {
  address: string;
  name?: string;
  type: "evm" | "solana";
  balances: Record<string, TokenBalance[]>;
}

const CDP_TIMEOUT_MS = 30_000;

export async function GET() {
  const { accessToken } = await withAuth();
  if (!accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = await verifyAdmin(accessToken);
  if (!isAdmin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const cdp = new CdpClient({
    apiKeyId: env.CDP_API_KEY_NAME,
    apiKeySecret: env.CDP_API_KEY_PRIVATE_KEY,
    walletSecret: env.CDP_WALLET_SECRET,
  });

  const timeout = AbortSignal.timeout(CDP_TIMEOUT_MS);
  const wallets: WalletAccount[] = [];
  const warnings: string[] = [];

  // Fetch all EVM accounts
  const evmAccounts: Array<{ address: string; name?: string }> = [];
  let evmPageToken: string | undefined;
  do {
    if (timeout.aborted) break;
    const page = await cdp.evm.listAccounts({
      pageSize: 100,
      ...(evmPageToken ? { pageToken: evmPageToken } : {}),
    });
    for (const acct of page.accounts ?? []) {
      evmAccounts.push({
        address: acct.address,
        name: acct.name,
      });
    }
    evmPageToken = page.nextPageToken ?? undefined;
  } while (evmPageToken);

  // Fetch all Solana accounts
  const solanaAccounts: Array<{ address: string; name?: string }> = [];
  let solPageToken: string | undefined;
  do {
    if (timeout.aborted) break;
    const page = await cdp.solana.listAccounts({
      pageSize: 100,
      ...(solPageToken ? { pageToken: solPageToken } : {}),
    });
    for (const acct of page.accounts ?? []) {
      solanaAccounts.push({
        address: acct.address,
        name: acct.name,
      });
    }
    solPageToken = page.nextPageToken ?? undefined;
  } while (solPageToken);

  // Fetch balances for EVM accounts across all EVM networks in parallel
  const evmBalancePromises = evmAccounts.map(async (acct) => {
    const balances: Record<string, TokenBalance[]> = {};
    const networkFetches = EVM_NETWORKS.map(async (network) => {
      try {
        const resp = await cdp.evm.listTokenBalances({
          address: acct.address as `0x${string}`,
          network,
        });
        const tokens: TokenBalance[] = [];
        for (const b of resp.balances ?? []) {
          tokens.push({
            token: b.token.name ?? "Unknown",
            symbol: b.token.symbol ?? "???",
            amount: String(b.amount.amount),
            decimals: Number(b.amount.decimals),
            contractAddress: b.token.contractAddress,
          });
        }
        if (tokens.length > 0) {
          balances[network] = tokens;
        }
      } catch (err) {
        const msg = `Failed to fetch ${network} balances for ${acct.address}`;
        console.error(msg, err);
        warnings.push(msg);
      }
    });
    await Promise.all(networkFetches);
    return {
      address: acct.address,
      name: acct.name,
      type: "evm" as const,
      balances,
    };
  });

  // Fetch balances for Solana accounts across Solana networks in parallel
  const solBalancePromises = solanaAccounts.map(async (acct) => {
    const balances: Record<string, TokenBalance[]> = {};
    const networkFetches = SOLANA_NETWORKS.map(async (network) => {
      try {
        const resp = await cdp.solana.listTokenBalances({
          address: acct.address,
          network,
        });
        const tokens: TokenBalance[] = [];
        for (const b of resp.balances ?? []) {
          tokens.push({
            token: b.token.name ?? "Unknown",
            symbol: b.token.symbol ?? "???",
            amount: String(b.amount.amount),
            decimals: Number(b.amount.decimals),
            contractAddress: b.token.mintAddress,
          });
        }
        if (tokens.length > 0) {
          balances[network] = tokens;
        }
      } catch (err) {
        const msg = `Failed to fetch ${network} balances for ${acct.address}`;
        console.error(msg, err);
        warnings.push(msg);
      }
    });
    await Promise.all(networkFetches);
    return {
      address: acct.address,
      name: acct.name,
      type: "solana" as const,
      balances,
    };
  });

  const allResults = await Promise.all([
    ...evmBalancePromises,
    ...solBalancePromises,
  ]);
  wallets.push(...allResults);

  if (timeout.aborted) {
    warnings.push("Request timed out — some accounts may be missing");
  }

  return Response.json({ wallets, warnings });
}
