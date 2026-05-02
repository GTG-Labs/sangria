"use client";

import { useEffect, useRef, useState } from "react";

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

function formatBalance(amount: string, decimals: number): string {
  if (decimals === 0) return amount;
  const padded = amount.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals);
  const fracPart = padded.slice(padded.length - decimals);
  const trimmed = fracPart.replace(/0+$/, "");
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

function truncateAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function networkLabel(network: string): string {
  switch (network) {
    case "base": return "Base";
    case "base-sepolia": return "Base Sepolia";
    case "ethereum": return "Ethereum";
    case "solana": return "Solana";
    case "solana-devnet": return "Solana Devnet";
    default: return network;
  }
}

function networkBadgeColor(network: string): string {
  switch (network) {
    case "base": return "bg-blue-500/20 text-blue-400";
    case "base-sepolia": return "bg-blue-500/10 text-blue-300";
    case "ethereum": return "bg-purple-500/20 text-purple-400";
    case "solana": return "bg-green-500/20 text-green-400";
    case "solana-devnet": return "bg-green-500/10 text-green-300";
    default: return "bg-gray-500/20 text-gray-400";
  }
}

export default function WalletsContent() {
  const [wallets, setWallets] = useState<WalletAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetch("/api/admin/wallets", { signal: controller.signal })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data) setWallets(data.wallets ?? []);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err.message ?? "Failed to fetch wallets");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  const totalBalances = wallets.reduce((acc, w) => {
    return acc + Object.values(w.balances).reduce((n, tokens) => n + tokens.length, 0);
  }, 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Wallets</h1>
        <p className="text-sm text-gray-400 mt-1">
          CDP accounts and live on-chain balances
        </p>
      </div>

      {/* Summary cards */}
      {!loading && !error && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="border border-white/10 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Total Accounts</div>
            <div className="text-2xl font-bold mt-1">{wallets.length}</div>
          </div>
          <div className="border border-white/10 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">EVM Accounts</div>
            <div className="text-2xl font-bold mt-1">{wallets.filter(w => w.type === "evm").length}</div>
          </div>
          <div className="border border-white/10 rounded-lg p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Token Balances</div>
            <div className="text-2xl font-bold mt-1">{totalBalances}</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-16 text-gray-500">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-500 border-t-white" />
          <p className="mt-3 text-sm">Fetching accounts from CDP...</p>
        </div>
      )}

      {error && (
        <div className="text-center py-16">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && wallets.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">No accounts found in CDP.</p>
        </div>
      )}

      {!loading && !error && wallets.length > 0 && (
        <div className="space-y-4">
          {wallets.map((wallet) => {
            const networkKeys = Object.keys(wallet.balances);
            const hasBalances = networkKeys.length > 0;

            return (
              <div
                key={wallet.address}
                className="border border-white/10 rounded-lg overflow-hidden"
              >
                {/* Wallet header */}
                <div className="px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
                        wallet.type === "evm"
                          ? "bg-blue-500/20 text-blue-400"
                          : "bg-green-500/20 text-green-400"
                      }`}
                    >
                      {wallet.type}
                    </span>
                    <code className="text-sm font-mono" title={wallet.address}>
                      {truncateAddress(wallet.address)}
                    </code>
                    {wallet.name && (
                      <span className="text-sm text-gray-400">({wallet.name})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => navigator.clipboard.writeText(wallet.address)}
                      className="text-xs text-gray-500 hover:text-white transition-colors"
                      title="Copy address"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Balances */}
                {hasBalances ? (
                  <div className="border-t border-white/5">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 uppercase tracking-wider">
                          <th className="text-left px-5 py-2 font-medium">Network</th>
                          <th className="text-left px-5 py-2 font-medium">Token</th>
                          <th className="text-right px-5 py-2 font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {networkKeys.map((network) =>
                          wallet.balances[network].map((token, i) => (
                            <tr
                              key={`${network}-${token.contractAddress}`}
                              className="border-t border-white/5"
                            >
                              <td className="px-5 py-2">
                                {i === 0 ? (
                                  <span className={`px-2 py-0.5 rounded text-xs ${networkBadgeColor(network)}`}>
                                    {networkLabel(network)}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-5 py-2 text-gray-300">
                                {token.symbol}
                              </td>
                              <td className="px-5 py-2 text-right font-mono">
                                {formatBalance(token.amount, token.decimals)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="border-t border-white/5 px-5 py-3 text-sm text-gray-500">
                    No token balances found
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
