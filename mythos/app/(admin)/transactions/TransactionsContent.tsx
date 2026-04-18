"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Transaction {
  id: string;
  idempotency_key: string;
  created_at: string;
  merchant_name: string;
  merchant_id: string;
  amount: number;
  fee: number;
  total: number;
  currency: string;
}

interface Totals {
  transaction_count: number;
  total_volume: number;
  total_fees: number;
  merchant_count: number;
}

interface LedgerEntry {
  id: string;
  amount: number;
  direction: "DEBIT" | "CREDIT";
  currency: string;
  account_name: string;
  account_type: string;
}

interface PaginatedResponse {
  data: Transaction[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
    count: number;
    limit: number;
    total: number;
  };
  totals?: Totals;
}

export default function TransactionsContent() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const fetchControllerRef = useRef<AbortController | null>(null);
  const ledgerControllerRef = useRef<AbortController | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  const buildUrl = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (cursor) params.set("cursor", cursor);
      if (activeSearch) params.set("search", activeSearch);
      return `/api/admin/transactions?${params}`;
    },
    [activeSearch]
  );

  const fetchTransactions = useCallback(
    async (cursor?: string) => {
      fetchControllerRef.current?.abort();
      const controller = new AbortController();
      fetchControllerRef.current = controller;

      const isInitialLoad = !cursor;
      isInitialLoad ? setLoading(true) : setLoadingMore(true);

      try {
        const response = await fetch(buildUrl(cursor), { signal: controller.signal });

        if (response.ok) {
          const data = (await response.json()) as PaginatedResponse;
          setTransactions((prev) =>
            cursor ? [...prev, ...data.data] : data.data
          );
          setNextCursor(data.pagination.next_cursor);
          setHasMore(data.pagination.has_more);
          setTotal(data.pagination.total);
          if (data.totals) setTotals(data.totals);
          setError(null);
        } else {
          const errorData = await response
            .json()
            .catch(() => ({ error: "Unknown error" }));
          setError(errorData.error || "Failed to load transactions");
          if (isInitialLoad) setTransactions([]);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError("Failed to load transactions");
        if (isInitialLoad) setTransactions([]);
      } finally {
        if (!controller.signal.aborted) {
          isInitialLoad ? setLoading(false) : setLoadingMore(false);
        }
      }
    },
    [buildUrl]
  );

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const selectTransaction = useCallback(async (tx: Transaction) => {
    ledgerControllerRef.current?.abort();
    const controller = new AbortController();
    ledgerControllerRef.current = controller;

    setSelectedTx(tx);
    setLedgerEntries([]);
    setLedgerLoading(true);
    try {
      const res = await fetch(`/api/admin/transactions/${tx.id}/ledger`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setLedgerEntries(data.entries ?? []);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted) {
        setLedgerLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedTx) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedTx(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedTx]);

  const handleSearch = () => {
    setActiveSearch(search);
  };

  const clearSearch = () => {
    setSearch("");
    setActiveSearch("");
  };

  const formatMicrounits = (microunits: number) => {
    const whole = Math.floor(microunits / 1_000_000);
    const frac = microunits % 1_000_000;
    const fracStr = frac
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "")
      .padEnd(2, "0");
    return `$${whole.toLocaleString("en-US")}.${fracStr}`;
  };

  const formatAmount = (microunits: number, currency: string) => {
    const whole = Math.floor(microunits / 1_000_000);
    const frac = microunits % 1_000_000;
    return `${whole}.${frac.toString().padStart(6, "0")} ${currency}`;
  };

  const truncateKey = (key: string) => {
    if (key.length <= 20) return key;
    return `${key.slice(0, 10)}...${key.slice(-8)}`;
  };

  const getBlockExplorerUrl = (hash: string) =>
    `https://basescan.org/tx/${hash}`;

  const timeAgo = (dateString: string) => {
    const seconds = Math.floor(
      (Date.now() - new Date(dateString).getTime()) / 1000
    );
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Transactions</h1>
        {total !== null && (
          <p className="mt-1 text-sm text-gray-500">
            {total} total across all merchants
          </p>
        )}
      </div>

      {/* Totals cards */}
      {totals && (
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Volume
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {formatMicrounits(totals.total_volume)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Transactions
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {totals.transaction_count.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-gray-800 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Merchants
            </p>
            <p className="mt-1 text-xl font-semibold text-white">
              {totals.merchant_count}
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-6 flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search by transaction hash..."
          className="flex-1 rounded-lg border border-gray-700 bg-transparent px-4 py-2 text-sm text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
        />
        <button
          onClick={handleSearch}
          className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:bg-white/5 hover:text-white transition-colors"
        >
          Search
        </button>
        {activeSearch && (
          <button
            onClick={clearSearch}
            className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:text-white transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {!error && (!transactions || transactions.length === 0) ? (
        <div className="py-16 text-center">
          <p className="text-gray-500 mb-1">
            {activeSearch ? "No transactions match your search" : "No transactions yet"}
          </p>
          <p className="text-sm text-gray-600">
            {activeSearch
              ? "Try a different search term."
              : "Transactions will appear here once merchants receive payments."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="pb-3 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Transaction
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Merchant
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fee
                </th>
                <th className="pb-3 pl-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr
                  key={tx.id}
                  onClick={() => selectTransaction(tx)}
                  className="border-b border-gray-800/50 hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <td className="py-4 pr-4">
                    {tx.idempotency_key.startsWith("0x") ? (
                      <a
                        href={getBlockExplorerUrl(tx.idempotency_key)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
                      >
                        <span className="font-mono">
                          {truncateKey(tx.idempotency_key)}
                        </span>
                        <svg
                          className="w-3.5 h-3.5 text-gray-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </a>
                    ) : (
                      <span className="font-mono text-sm text-gray-300">
                        {truncateKey(tx.idempotency_key)}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-4 text-sm text-gray-300">
                    {tx.merchant_name}
                  </td>
                  <td className="py-4 px-4 text-sm text-gray-300 font-mono">
                    +{formatAmount(tx.amount, tx.currency)}
                  </td>
                  <td className="py-4 px-4 text-sm text-gray-500 font-mono">
                    {formatAmount(tx.fee, tx.currency)}
                  </td>
                  <td className="py-4 pl-4 text-right text-sm text-gray-500">
                    {timeAgo(tx.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => fetchTransactions(nextCursor!)}
            disabled={loadingMore}
            className="px-5 py-2 text-sm border border-gray-700 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="mt-4 text-xs text-gray-600 text-center">
          Showing {transactions.length}
          {total !== null && ` of ${total}`} transaction
          {transactions.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Transaction detail panel */}
      {selectedTx && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setSelectedTx(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-800 bg-gray-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">
                Transaction Details
              </h2>
              <button
                onClick={() => setSelectedTx(null)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  Transaction ID
                </p>
                <p className="mt-1 text-sm text-gray-300 font-mono break-all">
                  {selectedTx.id}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  Transaction Hash
                </p>
                <p className="mt-1 text-sm text-gray-300 font-mono break-all">
                  {selectedTx.idempotency_key.startsWith("0x") ? (
                    <a
                      href={getBlockExplorerUrl(selectedTx.idempotency_key)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white transition-colors"
                    >
                      {selectedTx.idempotency_key}
                    </a>
                  ) : (
                    selectedTx.idempotency_key
                  )}
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  Merchant
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {selectedTx.merchant_name}
                </p>
                <p className="text-xs text-gray-600 font-mono">
                  {selectedTx.merchant_id}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-800 p-4">
                <div>
                  <p className="text-xs text-gray-500">Merchant received</p>
                  <p className="mt-1 text-sm font-semibold text-green-500 font-mono">
                    +{formatAmount(selectedTx.amount, selectedTx.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Platform fee</p>
                  <p className="mt-1 text-sm font-semibold text-gray-400 font-mono">
                    {formatAmount(selectedTx.fee, selectedTx.currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total payment</p>
                  <p className="mt-1 text-sm font-semibold text-white font-mono">
                    {formatAmount(selectedTx.total, selectedTx.currency)}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">
                  Time
                </p>
                <p className="mt-1 text-sm text-gray-300">
                  {new Date(selectedTx.created_at).toLocaleString()}
                </p>
                <p className="text-xs text-gray-600">
                  {timeAgo(selectedTx.created_at)}
                </p>
              </div>

              {/* Ledger Entries */}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Ledger Entries
                </p>
                {ledgerLoading ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-400" />
                  </div>
                ) : ledgerEntries.length === 0 ? (
                  <p className="text-xs text-gray-600">No ledger entries found.</p>
                ) : (
                  <div className="rounded-lg border border-gray-800 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/50">
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Direction</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">Account</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerEntries.map((entry) => (
                          <tr key={entry.id} className="border-b border-gray-800/50 last:border-0">
                            <td className="px-3 py-2">
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                entry.direction === "DEBIT"
                                  ? "bg-red-900/40 text-red-400"
                                  : "bg-green-900/40 text-green-400"
                              }`}>
                                {entry.direction}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className="text-gray-300">{entry.account_name}</span>
                              <span className="ml-1.5 text-gray-600">{entry.account_type}</span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-gray-300">
                              {formatAmount(entry.amount, entry.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
