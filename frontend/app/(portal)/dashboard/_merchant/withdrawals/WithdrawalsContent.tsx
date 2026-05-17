"use client";

import { useState, useEffect } from "react";
import { AlertCircle, X as XIcon } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";
import { useOrganization } from "@/contexts/OrganizationContext";
import { internalFetch } from "@/lib/fetch";
import WithdrawModal from "./WithdrawModal";

interface Withdrawal {
  id: string;
  organization_id: string;
  amount: number;
  fee: number;
  net_amount: number;
  status: string;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  canceled_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

interface PaginatedWithdrawalsResponse {
  data: Withdrawal[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
    count: number;
    limit: number;
    total: number;
  };
}

export default function WithdrawalsContent() {
  const { selectedOrgId } = useOrganization();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Clear list + pagination metadata after an initial-load failure so a stale
  // Load More button can't render below an empty state.
  const resetForInitialLoadFailure = () => {
    setWithdrawals([]);
    setHasMore(false);
    setNextCursor(null);
    setTotal(null);
  };

  const fetchWithdrawals = async (cursor?: string, signal?: AbortSignal) => {
    const isInitialLoad = !cursor;
    // Symmetric set: clear the opposite flag so a superseding fetch can't
    // leave the other flag stuck.
    if (isInitialLoad) {
      setLoading(true);
      setLoadingMore(false);
    } else {
      setLoadingMore(true);
      setLoading(false);
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", "20");
      if (selectedOrgId) params.set("org_id", selectedOrgId);
      if (cursor) params.set("cursor", cursor);

      const response = await internalFetch(`/api/backend/withdrawals?${params}`, { signal });

      if (signal?.aborted) return;

      if (response.ok) {
        const data = await response.json();

        if (data.data && data.pagination) {
          const paginatedData = data as PaginatedWithdrawalsResponse;
          setWithdrawals((prev) =>
            cursor ? [...prev, ...paginatedData.data] : paginatedData.data
          );
          setNextCursor(paginatedData.pagination.next_cursor);
          setHasMore(paginatedData.pagination.has_more);
          setTotal(paginatedData.pagination.total);
        } else if (Array.isArray(data)) {
          setWithdrawals(data);
          setHasMore(false);
          setTotal(data.length);
        }
        setError(null);
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || "Failed to load withdrawals");
        if (isInitialLoad) resetForInitialLoadFailure();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to load withdrawals:", err);
      setError("Failed to load withdrawals");
      if (isInitialLoad) resetForInitialLoadFailure();
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const fetchBalance = async (signal?: AbortSignal) => {
    try {
      const orgParam = selectedOrgId ? `?org_id=${selectedOrgId}` : "";
      const response = await internalFetch(`/api/backend/balance${orgParam}`, { signal });
      if (signal?.aborted) return;
      if (response.ok) {
        const data = await response.json();
        setBalance(data.balance);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("Failed to load balance:", err);
    }
  };

  const cancelWithdrawal = async (withdrawalId: string) => {
    if (!confirm("Are you sure you want to cancel this withdrawal?")) return;

    setCancellingId(withdrawalId);
    try {
      const response = await internalFetch(`/api/backend/withdrawals/${withdrawalId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organization_id: selectedOrgId }),
      });

      if (response.ok) {
        await Promise.all([fetchWithdrawals(), fetchBalance()]);
      } else {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || "Failed to cancel withdrawal");
      }
    } catch {
      setError("Failed to cancel withdrawal");
    } finally {
      setCancellingId(null);
    }
  };

  const handleWithdrawSuccess = async () => {
    setShowWithdrawModal(false);
    await Promise.all([fetchWithdrawals(), fetchBalance()]);
  };

  useEffect(() => {
    if (!selectedOrgId) return;

    const controller = new AbortController();

    setError(null);
    setShowWithdrawModal(false);
    setCancellingId(null);

    fetchBalance(controller.signal);
    fetchWithdrawals(undefined, controller.signal);

    return () => controller.abort();
  }, [selectedOrgId]);

  const formatMicrounits = (microunits: number) => {
    const whole = Math.floor(microunits / 1_000_000);
    const frac = microunits % 1_000_000;
    const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
    return `${whole.toLocaleString("en-US")}.${fracStr}`;
  };

  const formatBalance = formatMicrounits;
  const formatAmount = (microunits: number) => `$${formatMicrounits(microunits)}`;

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

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending_approval: "bg-yellow-100 text-yellow-800",
      approved: "bg-blue-100 text-blue-800",
      processing: "bg-blue-100 text-blue-800",
      completed: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
      reversed: "bg-purple-100 text-purple-800",
      canceled: "bg-gray-100 text-gray-800",
    };
    const labels: Record<string, string> = {
      pending_approval: "Pending",
      approved: "Approved",
      processing: "Processing",
      completed: "Completed",
      failed: "Failed",
      reversed: "Reversed",
      canceled: "Canceled",
    };
    return (
      <span
        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${styles[status] || "bg-gray-100 text-gray-800"}`}
      >
        {labels[status] || status}
      </span>
    );
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
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-8">
        <div>
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
        {selectedOrgId && balance !== null && balance > 0 && (
          <ArcadeButton
            onClick={() => setShowWithdrawModal(true)}
            size="sm"
            variant="blue"
          >
            Withdraw
          </ArcadeButton>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {!withdrawals || withdrawals.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-400 mb-1">No withdrawals yet</p>
          <p className="text-sm text-gray-400">
            Withdrawals will appear here once you request a payout.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200">
                <th className="pb-3 pr-6 text-left text-sm font-medium text-gray-400">
                  Amount
                </th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">
                  Fee
                </th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">
                  Net
                </th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">
                  Status
                </th>
                <th className="pb-3 px-6 text-left text-sm font-medium text-gray-400">
                  Requested
                </th>
                <th className="pb-3 pl-6 text-right text-sm font-medium text-gray-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w, i) => (
                <tr
                  key={w.id}
                  className={`border-b border-zinc-200 hover:bg-zinc-200/50 transition-colors ${i % 2 === 0 ? "bg-zinc-100/50" : ""
                    }`}
                >
                  <td className="py-4 pl-4 pr-6 text-sm text-gray-900">
                    {formatAmount(w.amount)}
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-500">
                    {formatAmount(w.fee)}
                  </td>
                  <td className="py-4 px-6 text-sm text-gray-900 font-medium">
                    {formatAmount(w.net_amount)}
                  </td>
                  <td className="py-4 px-6">{statusBadge(w.status)}</td>
                  <td className="py-4 px-6 text-sm text-gray-900">
                    {timeAgo(w.created_at)}
                  </td>
                  <td className="py-4 pl-6 pr-4 text-right">
                    {w.status === "pending_approval" && (
                      <button
                        onClick={() => cancelWithdrawal(w.id)}
                        disabled={cancellingId === w.id}
                        className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {cancellingId === w.id ? "Cancelling..." : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* hasMore is only true when nextCursor is non-null — backend sets
          HasMore: nextCursor != nil and only encodes NextCursor when non-nil */}
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => nextCursor && fetchWithdrawals(nextCursor)}
            disabled={loadingMore || !nextCursor}
            className="px-5 py-2 text-sm border border-zinc-200 rounded-lg text-gray-600 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {withdrawals.length > 0 && (
        <div className="mt-4 text-xs text-gray-400 text-center">
          Showing {withdrawals.length}
          {total !== null && ` of ${total}`} withdrawal
          {withdrawals.length !== 1 ? "s" : ""}
        </div>
      )}

      {showWithdrawModal && selectedOrgId && (
        <WithdrawModal
          selectedOrgId={selectedOrgId}
          balance={balance}
          onClose={() => setShowWithdrawModal(false)}
          onSuccess={handleWithdrawSuccess}
          formatBalance={formatBalance}
        />
      )}
    </div>
  );
}
