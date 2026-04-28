"use client";

import { Fragment, useState, useEffect, useRef } from "react";
import ActionDialog, { type ActionDialogField } from "./ActionDialog";

type DialogConfig = {
  title: string;
  message?: string;
  fields: ActionDialogField[];
  confirmLabel: string;
  confirmVariant: "primary" | "destructive";
  onConfirm: (values: Record<string, string>) => void;
};

interface Withdrawal {
  id: string;
  organization_id: string;
  amount: number;
  fee: number;
  net_amount: number;
  status: string;
  debit_transaction_id: string | null;
  completion_transaction_id: string | null;
  reversal_transaction_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  completed_by: string | null;
  failed_by: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  approved_at: string | null;
  processed_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  reversed_at: string | null;
  canceled_at: string | null;
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

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "approved", label: "Approved" },
  { value: "processing", label: "Processing" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "reversed", label: "Reversed" },
  { value: "canceled", label: "Canceled" },
];

export default function AdminWithdrawalsContent() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogConfig | null>(null);

  // Single in-flight controller shared across every entry point (effect,
  // Load More, post-action refetch). A new request aborts any previous one,
  // so stale responses can never commit to state.
  const fetchControllerRef = useRef<AbortController | null>(null);

  // Clear both list and pagination metadata after an initial-load failure so
  // a stale "Load More" button can't render below the empty state.
  const resetForInitialLoadFailure = () => {
    setWithdrawals([]);
    setHasMore(false);
    setNextCursor(null);
    setTotal(null);
  };

  const fetchWithdrawals = async (cursor?: string) => {
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;

    const isInitialLoad = !cursor;
    // Symmetric set: clear the opposite flag so a superseding fetch (e.g.
    // filter change during a Load More) can't leave the other flag stuck.
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
      if (statusFilter) params.set("status", statusFilter);
      if (cursor) params.set("cursor", cursor);

      const response = await fetch(`/api/admin/withdrawals?${params}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      if (response.ok) {
        const data = await response.json();
        if (controller.signal.aborted) return;

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
        if (controller.signal.aborted) return;
        setError(errorData.error || "Failed to load withdrawals");
        if (isInitialLoad) resetForInitialLoadFailure();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (controller.signal.aborted) return;
      console.error("Failed to load withdrawals:", err);
      setError("Failed to load withdrawals");
      if (isInitialLoad) resetForInitialLoadFailure();
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const performAction = async (
    withdrawalId: string,
    action: string,
    body?: Record<string, string>
  ) => {
    setActionLoading(withdrawalId);
    setError(null);

    try {
      const response = await fetch(
        `/api/admin/withdrawals/${withdrawalId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }
      );

      if (response.ok) {
        // Patch the acted-upon row in place using the returned Withdrawal
        // instead of full-refetching. Avoids the full-page loading spinner
        // (`loading` guard unmounts the table), preserves scroll position,
        // and keeps any expanded detail panel open. If the updated status no
        // longer matches the active filter, drop the row from the list and
        // decrement `total` so the filter's promise stays intact.
        const updated = (await response.json()) as Withdrawal;
        const droppedByFilter =
          !!statusFilter && updated.status !== statusFilter;
        setWithdrawals((prev) =>
          droppedByFilter
            ? prev.filter((w) => w.id !== updated.id)
            : prev.map((w) => (w.id === updated.id ? updated : w))
        );
        if (droppedByFilter) {
          setTotal((t) => (t !== null ? Math.max(0, t - 1) : t));
        }
      } else {
        const errorData = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        setError(errorData.error || `Failed to ${action} withdrawal`);
      }
    } catch {
      setError(`Failed to ${action} withdrawal`);
    } finally {
      setActionLoading(null);
    }
  };

  const closeDialog = () => setDialog(null);

  const handleApprove = (id: string) => {
    setDialog({
      title: "Approve withdrawal",
      fields: [
        {
          name: "note",
          label: "Note (optional)",
          type: "textarea",
          placeholder: "Add a note for the audit trail...",
          maxLength: 500,
        },
      ],
      confirmLabel: "Approve",
      confirmVariant: "primary",
      onConfirm: (values) => {
        closeDialog();
        const note = values.note?.trim();
        performAction(id, "approve", note ? { note } : {});
      },
    });
  };

  const handleReject = (id: string) => {
    setDialog({
      title: "Reject withdrawal",
      message:
        "This will reverse the balance debit. This action cannot be undone.",
      fields: [
        {
          name: "note",
          label: "Note (optional)",
          type: "textarea",
          placeholder: "Explain why this was rejected...",
          maxLength: 500,
        },
      ],
      confirmLabel: "Reject",
      confirmVariant: "destructive",
      onConfirm: (values) => {
        closeDialog();
        const note = values.note?.trim();
        performAction(id, "reject", note ? { note } : {});
      },
    });
  };

  const handleComplete = (id: string) => {
    setDialog({
      title: "Mark as completed",
      message:
        "This confirms the bank transfer has been sent. This action cannot be undone.",
      fields: [],
      confirmLabel: "Complete",
      confirmVariant: "primary",
      onConfirm: () => {
        closeDialog();
        performAction(id, "complete");
      },
    });
  };

  const handleFail = (id: string) => {
    setDialog({
      title: "Mark as failed",
      message: "Record the failure reason. This cannot be undone.",
      fields: [
        {
          name: "failure_code",
          label: "Failure code",
          placeholder: "e.g. BANK_REJECTED",
          required: true,
          maxLength: 100,
        },
        {
          name: "failure_message",
          label: "Failure message (optional)",
          type: "textarea",
          placeholder: "Additional context...",
          maxLength: 1000,
        },
      ],
      confirmLabel: "Fail",
      confirmVariant: "destructive",
      onConfirm: (values) => {
        closeDialog();
        performAction(id, "fail", {
          failure_code: values.failure_code.trim(),
          failure_message: (values.failure_message ?? "").trim(),
        });
      },
    });
  };

  useEffect(() => {
    setError(null);
    setActionLoading(null);
    fetchWithdrawals();
    return () => {
      fetchControllerRef.current?.abort();
    };
  }, [statusFilter]);

  const formatMicrounits = (microunits: number) => {
    const whole = Math.floor(microunits / 1_000_000);
    const frac = microunits % 1_000_000;
    const fracStr = frac
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "")
      .padEnd(2, "0");
    return `${whole.toLocaleString("en-US")}.${fracStr}`;
  };

  const formatAmount = (microunits: number) =>
    `$${formatMicrounits(microunits)}`;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

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

  const truncateId = (id: string) => {
    if (id.length <= 12) return id;
    return `${id.slice(0, 6)}...${id.slice(-4)}`;
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending_approval: "bg-yellow-900/40 text-yellow-400",
      approved: "bg-blue-900/40 text-blue-400",
      processing: "bg-blue-900/40 text-blue-400",
      completed: "bg-green-900/40 text-green-400",
      failed: "bg-red-900/40 text-red-400",
      reversed: "bg-purple-900/40 text-purple-400",
      canceled: "bg-gray-800 text-gray-400",
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
        className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${styles[status] || "bg-gray-800 text-gray-400"}`}
      >
        {labels[status] || status}
      </span>
    );
  };

  const detailRow = (label: string, value: string | null, mono = false) => (
    <div className="flex gap-4 py-1 text-sm">
      <span className="w-32 shrink-0 text-gray-500">{label}</span>
      <span
        className={`break-all ${mono ? "font-mono text-xs text-gray-400" : "text-gray-300"}`}
      >
        {value || "—"}
      </span>
    </div>
  );

  const detailSection = (title: string, rows: React.ReactNode) => (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      {rows}
    </div>
  );

  const renderDetailPanel = (w: Withdrawal) => {
    const hasReview = w.reviewed_by || w.reviewed_at || w.review_note;
    const hasCompletion = !!w.completed_by;
    const hasFailure = w.failed_by || w.failure_code || w.failure_message;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
        {detailSection(
          "Identifiers",
          <>
            {detailRow("ID", w.id, true)}
            {detailRow("Organization ID", w.organization_id, true)}
          </>
        )}
        {detailSection(
          "Timeline",
          <>
            {detailRow("Requested", formatDate(w.created_at))}
            {detailRow("Approved", w.approved_at && formatDate(w.approved_at))}
            {detailRow(
              "Processed",
              w.processed_at && formatDate(w.processed_at)
            )}
            {detailRow(
              "Completed",
              w.completed_at && formatDate(w.completed_at)
            )}
            {detailRow("Failed", w.failed_at && formatDate(w.failed_at))}
            {detailRow(
              "Reversed",
              w.reversed_at && formatDate(w.reversed_at)
            )}
            {detailRow(
              "Canceled",
              w.canceled_at && formatDate(w.canceled_at)
            )}
          </>
        )}
        {hasReview &&
          detailSection(
            "Review",
            <>
              {detailRow("Reviewer", w.reviewed_by, true)}
              {detailRow(
                "Reviewed at",
                w.reviewed_at && formatDate(w.reviewed_at)
              )}
              {detailRow("Note", w.review_note)}
            </>
          )}
        {hasCompletion &&
          detailSection(
            "Completion",
            detailRow("Completed by", w.completed_by, true)
          )}
        {hasFailure &&
          detailSection(
            "Failure",
            <>
              {detailRow("Failed by", w.failed_by, true)}
              {detailRow("Code", w.failure_code)}
              {detailRow("Message", w.failure_message)}
            </>
          )}
        {detailSection(
          "Ledger Transactions",
          <>
            {detailRow("Debit", w.debit_transaction_id, true)}
            {detailRow("Completion", w.completion_transaction_id, true)}
            {detailRow("Reversal", w.reversal_transaction_id, true)}
          </>
        )}
      </div>
    );
  };

  const renderActions = (w: Withdrawal) => {
    const isLoading = actionLoading === w.id;

    if (isLoading) {
      return <span className="text-xs text-gray-500">Processing...</span>;
    }

    switch (w.status) {
      case "pending_approval":
        return (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => handleApprove(w.id)}
              className="px-2.5 py-1 text-xs font-medium text-green-400 border border-green-900/60 rounded-md hover:bg-green-900/40 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleReject(w.id)}
              className="px-2.5 py-1 text-xs font-medium text-red-400 border border-red-900/60 rounded-md hover:bg-red-900/40 transition-colors"
            >
              Reject
            </button>
          </div>
        );
      case "approved":
      case "processing":
        return (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => handleComplete(w.id)}
              className="px-2.5 py-1 text-xs font-medium text-green-400 border border-green-900/60 rounded-md hover:bg-green-900/40 transition-colors"
            >
              Complete
            </button>
            <button
              onClick={() => handleFail(w.id)}
              className="px-2.5 py-1 text-xs font-medium text-red-400 border border-red-900/60 rounded-md hover:bg-red-900/40 transition-colors"
            >
              Fail
            </button>
          </div>
        );
      default:
        return null;
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Withdrawals</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage withdrawal requests across all organizations.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter withdrawals by status"
          className="rounded-lg border border-gray-700 bg-transparent px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              className="bg-gray-950 text-white"
            >
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg flex items-center gap-2 text-red-400">
          <span className="flex-1 text-sm">{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-red-500 hover:text-red-300 transition-colors"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      )}

      {!withdrawals || withdrawals.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-500 mb-1">No withdrawals found</p>
          <p className="text-sm text-gray-600">
            {statusFilter
              ? "Try a different status filter."
              : "Withdrawals will appear here once organizations request payouts."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="pb-3 pr-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Organization
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fee
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Net
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="pb-3 px-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Requested
                </th>
                <th className="pb-3 pl-4 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => {
                const isExpanded = expandedId === w.id;
                const toggle = () =>
                  setExpandedId(isExpanded ? null : w.id);
                return (
                  <Fragment key={w.id}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        // Only toggle when the keydown originates on the row
                        // itself (not bubbled from a focused descendant like
                        // an action button) so we don't hijack button
                        // activation or double-fire on Space.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                      className="border-b border-gray-800/50 hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <td className="py-4 pr-4 font-mono text-xs text-gray-500">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="select-none text-gray-500 w-3 inline-block"
                          >
                            {isExpanded ? "▾" : "▸"}
                          </span>
                          {truncateId(w.id)}
                        </div>
                      </td>
                      <td className="py-4 px-4 font-mono text-xs text-gray-500">
                        {truncateId(w.organization_id)}
                      </td>
                      <td className="py-4 px-4 text-sm text-gray-300 font-mono">
                        {formatAmount(w.amount)}
                      </td>
                      <td className="py-4 px-4 text-sm text-gray-500 font-mono">
                        {formatAmount(w.fee)}
                      </td>
                      <td className="py-4 px-4 text-sm text-white font-mono font-medium">
                        {formatAmount(w.net_amount)}
                      </td>
                      <td className="py-4 px-4">{statusBadge(w.status)}</td>
                      <td className="py-4 px-4 text-sm text-gray-500">
                        {timeAgo(w.created_at)}
                      </td>
                      <td
                        className="py-4 pl-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {renderActions(w)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-gray-800/50 bg-gray-900/40">
                        <td colSpan={8} className="px-6 py-6">
                          {renderDetailPanel(w)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => nextCursor && fetchWithdrawals(nextCursor)}
            disabled={loadingMore || !nextCursor}
            className="px-5 py-2 text-sm border border-gray-700 rounded-lg text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}

      {withdrawals.length > 0 && (
        <div className="mt-4 text-xs text-gray-600 text-center">
          Showing {withdrawals.length}
          {total !== null && ` of ${total}`} withdrawal
          {withdrawals.length !== 1 ? "s" : ""}
        </div>
      )}

      {dialog && (
        <ActionDialog
          title={dialog.title}
          message={dialog.message}
          fields={dialog.fields}
          confirmLabel={dialog.confirmLabel}
          confirmVariant={dialog.confirmVariant}
          onConfirm={dialog.onConfirm}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
