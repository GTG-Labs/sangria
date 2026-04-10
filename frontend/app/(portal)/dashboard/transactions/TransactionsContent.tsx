"use client";

import { useState, useEffect } from "react";
import { ExternalLink, AlertCircle } from "lucide-react";

interface Transaction {
  id: string;
  idempotency_key: string;
  created_at: string;
  amount: number; // microunits
  currency: string;
  type: string;
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
}

export default function TransactionsContent() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  const fetchTransactions = async (cursor?: string) => {
    const isInitialLoad = !cursor;
    isInitialLoad ? setLoading(true) : setLoadingMore(true);

    try {
      const url = cursor
        ? `/api/backend/transactions?limit=20&cursor=${encodeURIComponent(cursor)}`
        : `/api/backend/transactions?limit=20`;

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        if (Array.isArray(data)) {
          setTransactions(data);
          setHasMore(false);
          setTotal(data.length);
        } else {
          const paginatedData = data as PaginatedResponse;
          setTransactions((prev) =>
            cursor ? [...prev, ...paginatedData.data] : paginatedData.data
          );
          setNextCursor(paginatedData.pagination.next_cursor);
          setHasMore(paginatedData.pagination.has_more);
          setTotal(paginatedData.pagination.total);
        }
        setError(null);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || "Failed to load transactions");
        if (isInitialLoad) setTransactions([]);
      }
    } catch (err) {
      console.error("Failed to load transactions:", err);
      setError("Failed to load transactions");
      if (isInitialLoad) setTransactions([]);
    } finally {
      isInitialLoad ? setLoading(false) : setLoadingMore(false);
    }
  };

  const fetchBalance = async () => {
    try {
      const response = await fetch("/api/backend/balance");
      if (response.ok) {
        const data = await response.json();
        setBalance(data.balance);
      }
    } catch (err) {
      console.error("Failed to load balance:", err);
    }
  };

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
  }, []);

  const formatBalance = (microunits: number) => {
    const whole = Math.floor(microunits / 1_000_000);
    const frac = microunits % 1_000_000;
    // Full 6-digit fractional part, then trim trailing zeros, keep at least 2
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
    return `${whole.toLocaleString("en-US")}.${fracStr}`;
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

  const getBlockExplorerUrl = (hash: string) => {
    return `https://basescan.org/tx/${hash}`;
  };

  const timeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `about ${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `about ${hours} hour${hours !== 1 ? "s" : ""} ago`;
    const days = Math.floor(hours / 24);
    return `about ${days} day${days !== 1 ? "s" : ""} ago`;
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <p className="text-sm font-medium text-gray-500">Balance</p>
        {balance !== null ? (
          <p className="mt-1 text-4xl sm:text-5xl font-semibold tracking-tight text-gray-900">
            ${formatBalance(balance)}
            <span className="ml-2 text-lg font-normal text-gray-400">USD</span>
          </p>
        ) : (
          <div className="mt-1 h-12 w-48 animate-pulse rounded-lg bg-gray-200" />
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {!transactions || transactions.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 mb-1">No transactions yet</p>
          <p className="text-sm text-gray-400">
            Transactions will appear here once you receive payments.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="pb-3 pr-6 text-left text-sm font-medium text-gray-400">
                  Transaction
                </th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">
                  Status
                </th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">
                  Amount
                </th>
                <th className="pb-3 pl-6 text-right text-sm font-medium text-gray-400">
                  Sent
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr
                  key={tx.id}
                  className={`border-b border-zinc-200 hover:bg-zinc-200/50 transition-colors ${
                    i % 2 === 0 ? "bg-zinc-100/50" : ""
                  }`}
                >
                  <td className="py-4 pl-4 pr-6">
                    {tx.idempotency_key.startsWith("0x") ? (
                      <a
                        href={getBlockExplorerUrl(tx.idempotency_key)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-gray-900 hover:text-sangria-600 transition-colors"
                      >
                        <span className="font-mono">
                          {truncateKey(tx.idempotency_key)}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
                      </a>
                    ) : (
                      <span className="font-mono text-sm text-gray-900">
                        {truncateKey(tx.idempotency_key)}
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-sm font-medium text-green-600">
                      Received
                    </span>
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-900">
                    +{formatAmount(tx.amount, tx.currency)}
                  </td>
                  <td className="py-4 pl-6 pr-4 text-right text-sm text-gray-900">
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
            className="px-5 py-2 text-sm border border-zinc-200 rounded-lg text-gray-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="mt-4 text-xs text-gray-400 text-center">
          Showing {transactions.length}
          {total !== null && ` of ${total}`} transaction
          {transactions.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
