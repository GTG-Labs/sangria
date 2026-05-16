"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { internalFetch } from "@/lib/fetch";

interface ClientTransaction {
  id: string;
  resource: string;
  amount: number;
  currency: string;
  status: "confirmed" | "pending" | "failed";
  createdAt: string;
}

interface PaginatedResponse {
  data: ClientTransaction[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    count: number;
    limit: number;
    total: number;
  };
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "text-green-600",
  pending: "text-yellow-600",
  failed: "text-red-500",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Sent",
  pending: "Pending",
  failed: "Failed",
};

function formatAmount(microunits: number, currency: string) {
  const dollars = microunits / 1_000_000;
  return `${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${currency}`;
}

function timeAgo(dateString: string) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ClientTransactionsContent() {
  const [transactions, setTransactions] = useState<ClientTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resetForInitialLoadFailure = () => {
    setTransactions([]);
    setHasMore(false);
    setNextCursor(null);
    setTotal(null);
  };

  const fetchTransactions = async (cursor?: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    const isInitialLoad = !cursor;
    if (isInitialLoad) {
      setLoading(true);
      setLoadingMore(false);
    } else {
      setLoadingMore(true);
      setLoading(false);
    }

    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);

      const response = await internalFetch(`/api/client/transactions?${params}`, { signal });
      if (signal.aborted) return;

      if (response.ok) {
        const data = (await response.json()) as PaginatedResponse;
        if (signal.aborted) return;

        setTransactions((prev) => (cursor ? [...prev, ...data.data] : data.data));
        setNextCursor(data.pagination.nextCursor);
        setHasMore(data.pagination.hasMore);
        setTotal(data.pagination.total);
        setError(null);
      } else {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        if (signal.aborted) return;
        setError(errData.error ?? "Failed to load transactions");
        if (isInitialLoad) resetForInitialLoadFailure();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to load transactions");
      if (isInitialLoad) resetForInitialLoadFailure();
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    fetchTransactions();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Transactions</h1>
        <p className="mt-1 text-sm text-gray-500">All payments made by your agent.</p>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {transactions.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400">No transactions yet</p>
          <p className="mt-1 text-sm text-gray-400">
            Payments your agent makes will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="pb-3 pr-6 text-left text-sm font-medium text-gray-400">Resource</th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">Status</th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">Amount</th>
                <th className="pb-3 pl-6 text-right text-sm font-medium text-gray-400">When</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr
                  key={tx.id}
                  className={`border-b border-zinc-200 transition-colors hover:bg-zinc-200/50 ${
                    i % 2 === 0 ? "bg-zinc-100/50" : ""
                  }`}
                >
                  <td className="py-4 pl-4 pr-6">
                    <span className="font-mono text-sm text-gray-900">{tx.resource}</span>
                  </td>
                  <td className="py-4 px-6">
                    <span className={`text-sm font-medium ${STATUS_STYLES[tx.status] ?? "text-gray-500"}`}>
                      {STATUS_LABELS[tx.status] ?? tx.status}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-900">
                    -{formatAmount(tx.amount, tx.currency)}
                  </td>
                  <td className="py-4 pl-6 pr-4 text-right text-sm text-gray-400">
                    {timeAgo(tx.createdAt)}
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
            onClick={() => { if (nextCursor) fetchTransactions(nextCursor); }}
            disabled={loadingMore || !nextCursor}
            className="rounded-lg border border-zinc-200 px-5 py-2 text-sm text-gray-600 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {transactions.length > 0 && (
        <p className="mt-4 text-center text-xs text-gray-400">
          Showing {transactions.length}
          {total !== null && ` of ${total}`} transaction
          {transactions.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
