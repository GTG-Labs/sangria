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
    case "base": return "bg-blue-500/15 text-blue-400";
    case "base-sepolia": return "bg-blue-500/10 text-blue-300";
    case "ethereum": return "bg-purple-500/15 text-purple-400";
    case "solana": return "bg-green-500/15 text-green-400";
    case "solana-devnet": return "bg-green-500/10 text-green-300";
    default: return "bg-zinc-500/15 text-zinc-400";
  }
}

export default function WalletsContent() {
  const [wallets, setWallets] = useState<WalletAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
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
        if (data) {
          setWallets(data.wallets ?? []);
          setWarnings(data.warnings ?? []);
        }
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

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      return;
    }
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress((prev) => (prev === address ? null : prev)), 1500);
  };

  const totalBalances = wallets.reduce((acc, w) => {
    return acc + Object.values(w.balances).reduce((n, tokens) => n + tokens.length, 0);
  }, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-soft" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-fg">Wallets</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {wallets.length} CDP account{wallets.length !== 1 ? "s" : ""} with live on-chain balances
        </p>
      </div>

      {/* Summary cards */}
      {!error && (
        <div className="mb-8 flex rounded-xl border border-white/8 bg-surface divide-x divide-white/8">
          <div className="flex-1 px-5 py-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Accounts</p>
            <p className="mt-1 text-xl font-semibold text-fg">{wallets.length}</p>
          </div>
          <div className="flex-1 px-5 py-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">EVM</p>
            <p className="mt-1 text-xl font-semibold text-fg">
              {wallets.filter((w) => w.type === "evm").length}
            </p>
          </div>
          <div className="flex-1 px-5 py-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Token Balances</p>
            <p className="mt-1 text-xl font-semibold text-fg">{totalBalances}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {!error && warnings.length > 0 && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
          Some balances could not be loaded ({warnings.length} network{warnings.length !== 1 ? "s" : ""} failed)
        </div>
      )}

      {!error && wallets.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-zinc-500 mb-1">No accounts found</p>
          <p className="text-sm text-zinc-600">
            CDP accounts will appear here once created.
          </p>
        </div>
      ) : !error ? (
        <div className="space-y-3">
          {wallets.map((wallet) => {
            const networks = Object.keys(wallet.balances);

            return (
              <div
                key={wallet.address}
                className="rounded-xl border border-white/8 bg-surface overflow-hidden"
              >
                {/* Wallet header */}
                <div className="px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${
                        wallet.type === "evm"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-green-500/15 text-green-400"
                      }`}
                    >
                      {wallet.type}
                    </span>
                    <code className="text-sm font-mono text-zinc-300" title={wallet.address}>
                      {truncateAddress(wallet.address)}
                    </code>
                    {wallet.type === "evm" && (
                      <a
                        href={`https://${networks.includes("base") ? "basescan.org" : "sepolia.basescan.org"}/address/${wallet.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group/scan flex items-center gap-1 text-zinc-600 hover:text-fg transition-all p-1"
                      >
                        <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs transition-all duration-200 group-hover/scan:max-w-40">
                          Open in BaseScan
                        </span>
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                    {wallet.name && (
                      <span className="text-sm text-zinc-500">({wallet.name})</span>
                    )}
                  </div>
                  <button
                    onClick={() => copyAddress(wallet.address)}
                    aria-label={`Copy address ${wallet.address}`}
                    className="text-zinc-600 hover:text-fg transition-colors p-1"
                    title="Copy address"
                  >
                    {copiedAddress === wallet.address ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>

                {/* Balances */}
                {networks.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-t border-white/5">
                        <th className="px-5 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                          Network
                        </th>
                        <th className="px-5 py-2 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                          Token
                        </th>
                        <th className="px-5 py-2 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                          Balance
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {networks.map((network) =>
                        wallet.balances[network].map((token, i) => (
                          <tr
                            key={`${network}-${token.contractAddress}`}
                            className="border-t border-white/5 hover:bg-elevated transition-colors"
                          >
                            <td className="px-5 py-2.5">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs ${networkBadgeColor(network)}`}>
                                {networkLabel(network)}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-zinc-300">
                              {token.symbol}
                            </td>
                            <td className="px-5 py-2.5 text-right font-mono text-zinc-300">
                              {formatBalance(token.amount, token.decimals)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <div className="border-t border-white/5 px-5 py-3 text-sm text-zinc-600">
                    No token balances found
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {!error && wallets.length > 0 && (
        <div className="mt-4 text-xs text-zinc-600 text-center">
          Showing {wallets.length} account{wallets.length !== 1 ? "s" : ""} · {totalBalances} token balance{totalBalances !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
