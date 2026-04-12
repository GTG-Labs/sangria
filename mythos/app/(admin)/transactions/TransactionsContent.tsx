"use client";

import { useState, useEffect } from "react";

interface Transaction {
  id: string;
  idempotency_key: string;
  created_at: string;
  amount: number;
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

  const fetchTransactions = async (cursor?: string) => {
    const isInitialLoad = !cursor;
    isInitialLoad ? setLoading(true) : setLoadingMore(true);

    try {
      const url = cursor
        ? `/api/admin/transactions?limit=20&cursor=${encodeURIComponent(cursor)}`
        : `/api/admin/transactions?limit=20`;

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

  useEffect(() => {
    fetchTransactions();
  }, []);

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
    if (minutes < 60)
      return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
      return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Transactions</h1>
          {total !== null && (
            <p className="mt-1 text-sm text-gray-500">
              {total} total across all merchants
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {!transactions || transactions.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-500 mb-1">No transactions yet</p>
          <p className="text-sm text-gray-600">
            Transactions will appear here once merchants receive payments.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="pb-3 pr-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Transaction
                </th>
                <th className="pb-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="pb-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="pb-3 pl-6 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr
                  key={tx.id}
                  className="border-b border-gray-800/50 hover:bg-white/5 transition-colors"
                >
                  <td className="py-4 pr-6">
                    {tx.idempotency_key.startsWith("0x") ? (
                      <a
                        href={getBlockExplorerUrl(tx.idempotency_key)}
                        target="_blank"
                        rel="noopener noreferrer"
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
                  <td className="py-4 px-6">
                    <span className="text-sm font-medium text-green-500">
                      Received
                    </span>
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-300 font-mono">
                    +{formatAmount(tx.amount, tx.currency)}
                  </td>
                  <td className="py-4 pl-6 text-right text-sm text-gray-500">
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
    </div>
  );
}
