"use client";

import { useState, useEffect } from "react";
import { ExternalLink, AlertCircle } from "lucide-react";

interface Transaction {
  id: string;
  idempotency_key: string;
  created_at: string;
  amount: number; // microunits
  currency: string;
  network: string;
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
        ? `/api/backend/transactions?limit=20&cursor=${encodeURIComponent(cursor)}`
        : `/api/backend/transactions?limit=20`;

      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();

        // Handle both old format (array) and new format (paginated)
        if (Array.isArray(data)) {
          // Legacy format - no pagination
          setTransactions(data);
          setHasMore(false);
          setTotal(data.length);
        } else {
          // New paginated format
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
        if (isInitialLoad) {
          setTransactions([]);
        }
      }
    } catch (err) {
      console.error("Failed to load transactions:", err);
      setError("Failed to load transactions");
      if (isInitialLoad) {
        setTransactions([]);
      }
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

  const getBlockExplorerUrl = (hash: string, network: string) => {
    const explorers: Record<string, string> = {
      base: `https://basescan.org/tx/${hash}`,
      "base-sepolia": `https://sepolia.basescan.org/tx/${hash}`,
      polygon: `https://polygonscan.com/tx/${hash}`,
    };
    return explorers[network] || `https://basescan.org/tx/${hash}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
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
        <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-gray-900">
          Transactions
        </h1>
        <p className="mt-2 text-gray-500">
          View your payment transaction history.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {!transactions || transactions.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto w-16 h-16 mb-4 text-gray-300">
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
                />
              </svg>
            </div>
            <p className="text-gray-500 mb-2 font-medium">
              No transactions yet
            </p>
            <p className="text-sm text-gray-400">
              Transactions will appear here once you receive payments.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Network
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transaction
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(tx.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">
                        Payment Received
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      +{formatAmount(tx.amount, tx.currency)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span className="inline-flex items-center gap-1">
                        {tx.network ? (
                          <>
                            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                            {tx.network.charAt(0).toUpperCase() +
                              tx.network.slice(1)}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {tx.idempotency_key.startsWith("0x") ? (
                        <a
                          href={getBlockExplorerUrl(
                            tx.idempotency_key,
                            tx.network,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sangria-600 hover:text-sangria-800 transition-colors"
                        >
                          <span className="font-mono text-xs">
                            {tx.idempotency_key.slice(0, 10)}...
                            {tx.idempotency_key.slice(-8)}
                          </span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="font-mono text-xs text-gray-500">
                          {tx.idempotency_key.slice(0, 10)}...
                          {tx.idempotency_key.slice(-8)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => fetchTransactions(nextCursor!)}
            disabled={loadingMore}
            className="px-6 py-2 bg-sangria-600 text-white rounded-lg hover:bg-sangria-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMore ? (
              <span className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Loading...
              </span>
            ) : (
              "Load More"
            )}
          </button>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="mt-4 text-sm text-gray-500 text-center">
          Showing {transactions.length}
          {total !== null && ` of ${total}`} transaction
          {transactions.length !== 1 ? "s" : ""}
          {hasMore && " • Load more to see older transactions"}
        </div>
      )}
    </div>
  );
}
