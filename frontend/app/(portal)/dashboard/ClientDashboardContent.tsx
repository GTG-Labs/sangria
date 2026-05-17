"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { AlertCircle, Plus } from "lucide-react";
import { internalFetch } from "@/lib/fetch";
import AgentCard, { type APIKeyIdentity } from "@/components/AgentCard";
import ArcadeButton from "@/components/ArcadeButton";
import TopUpModal from "@/components/TopUpModal";
import CreateAgentKeyModal from "@/components/CreateAgentKeyModal";
import CardSettingsModal, {
  type CardSettings,
} from "@/components/CardSettingsModal";

// APIKeyView carries everything CardSettingsModal needs to pre-fill its form,
// on top of the visual identity the dashboard renders.
interface APIKeyView extends APIKeyIdentity {
  maxPerCallMicrounits: string;
  dailyCapMicrounits: string;
  monthlyCapMicrounits: string;
  createdAt: string;
}

interface AgentInfo {
  operatorId: string;
  apiKeys: APIKeyView[];
  balanceMicrounits: string;
  trialMicrounits: string;
  paidMicrounits: string;
}

interface ClientTransaction {
  id: string;
  resource: string;
  amount: number;
  currency: string;
  status: "confirmed" | "pending" | "failed";
  createdAt: string;
}

const DASHBOARD_CARD_LIMIT = 6;

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

function formatDollars(microunits: string) {
  const dollars = parseInt(microunits, 10) / 1_000_000;
  return dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatAmount(microunits: number) {
  const dollars = microunits / 1_000_000;
  return dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function timeAgo(dateString: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ClientDashboardContent() {
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [transactions, setTransactions] = useState<ClientTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  // Selected card for the settings modal. Reading `apiKeys.find(k.id === ...)`
  // on every render lets a settings save → refetch reflect the new caps
  // inside the still-open modal without extra prop wiring.
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Track whether we've already loaded once. Background refetches (after
  // creating a key, after a top-up) must NOT flip `loading` back to true —
  // doing so would early-return the spinner and unmount the open modal,
  // throwing away its internal one-time-secret state mid-reveal.
  const initialLoadedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!initialLoadedRef.current) setLoading(true);
    setError(null);

    try {
      const [agentRes, txRes] = await Promise.all([
        internalFetch("/api/client/agent", { signal: controller.signal }),
        internalFetch("/api/client/transactions?limit=5", {
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted) return;

      if (!agentRes.ok) {
        setError("Failed to load agent data");
        return;
      }
      const agentData = (await agentRes.json()) as AgentInfo;
      if (controller.signal.aborted) return;
      setAgent(agentData);

      // Transactions are optional — a brand-new operator hasn't paid anyone
      // yet, so a 4xx on this endpoint shouldn't block the rest of the page.
      if (txRes.ok) {
        const txData = await txRes.json();
        if (controller.signal.aborted) return;
        setTransactions(
          ((txData.data ?? txData) as ClientTransaction[]).slice(0, 5),
        );
      } else {
        setTransactions([]);
      }
      initialLoadedRef.current = true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to load agent data");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  // Handle the Stripe Checkout return. ?topup=success/cancel sticks around
  // after the redirect — strip it from the URL so a manual refresh doesn't
  // re-trigger the toast/refetch, and refetch the balance on success since
  // the webhook may already have credited the ledger by the time the user
  // lands back here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    if (!topup) return;
    if (topup === "success") {
      void fetchAll();
    } else if (topup === "cancel") {
      setError("Top-up canceled.");
    }
    window.history.replaceState({}, "", "/dashboard");
  }, [fetchAll]);

  // Revoke handler shared by the settings modal. The modal already gates the
  // call behind a confirm-on-second-click button, so we don't double-confirm
  // here — just call the backend, refresh, and close the modal.
  const handleRevoke = useCallback(
    async (keyId: string) => {
      const res = await internalFetch(
        `/api/client/agent/keys/${encodeURIComponent(keyId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setError("Failed to revoke key");
        return;
      }
      await fetchAll();
    },
    [fetchAll],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
      </div>
    );
  }

  const cards = agent?.apiKeys ?? [];
  // Re-resolve selected card on every render against the latest state so a
  // background refetch (after Save in the settings modal) flows the new
  // caps back through.
  const selectedCard: CardSettings | null = selectedCardId
    ? cards.find((c) => c.id === selectedCardId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your agents&apos; balance and recent payments.
        </p>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Operator-level summary — balance + top-up + add-card. Each top-up
          is a one-off charge (no saved card), so the dashboard only shows
          balance and action buttons; the card form opens fresh each time
          from inside TopUpModal. */}
      <div className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-gray-400">
              Balance
            </p>
            <p className="mt-1 text-3xl font-semibold text-gray-900 tabular-nums">
              ${agent ? formatDollars(agent.balanceMicrounits) : "0.00"}
              <span className="ml-1.5 text-sm font-normal text-gray-400">
                USD
              </span>
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <ArcadeButton
              variant="secondary"
              size="sm"
              onClick={() => setCreateKeyOpen(true)}
            >
              <Plus className="mr-1.5 inline h-4 w-4" />
              New card
            </ArcadeButton>
            <ArcadeButton size="sm" onClick={() => setTopUpOpen(true)}>
              Top Up
            </ArcadeButton>
          </div>
        </div>
      </div>

      {/* Cards grid — one card per active API key. Click a card to open its
          settings modal (caps editor + revoke action). Capped at
          DASHBOARD_CARD_LIMIT so the dashboard stays scannable; the full list
          lives at /dashboard/cards. */}
      <div className="mb-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Your cards
            {cards.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({cards.length})
              </span>
            )}
          </h2>
          {cards.length > DASHBOARD_CARD_LIMIT && (
            <Link
              href="/dashboard/cards"
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              View all
            </Link>
          )}
        </div>

        {cards.length === 0 ? (
          <button
            onClick={() => setCreateKeyOpen(true)}
            className="flex w-full max-w-[340px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 bg-white/50 py-12 text-sm text-gray-500 transition-colors hover:border-sangria-400 hover:bg-white hover:text-sangria-600"
            style={{ aspectRatio: "1.586" }}
          >
            <Plus className="h-6 w-6" />
            Create your first card
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.slice(0, DASHBOARD_CARD_LIMIT).map((k) => (
              <AgentCard key={k.id} apiKey={k} onClick={setSelectedCardId} />
            ))}
          </div>
        )}
      </div>

      {/* Recent transactions */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Recent Payments
          </h2>
          <Link
            href="/dashboard/transactions"
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            View all
          </Link>
        </div>

        {transactions.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-gray-400">No payments yet.</p>
            <p className="mt-1 text-xs text-gray-400">
              Your agents&apos; payments will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="pb-3 pr-6 text-left text-xs font-medium text-gray-400">
                    Resource
                  </th>
                  <th className="pb-3 px-6 text-left text-xs font-medium text-gray-400">
                    Status
                  </th>
                  <th className="pb-3 px-6 text-left text-xs font-medium text-gray-400">
                    Amount
                  </th>
                  <th className="pb-3 pl-6 text-right text-xs font-medium text-gray-400">
                    When
                  </th>
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
                    <td className="py-3.5 pl-4 pr-6">
                      <span className="font-mono text-xs text-gray-700 truncate max-w-[180px] block">
                        {tx.resource}
                      </span>
                    </td>
                    <td className="py-3.5 px-6">
                      <span
                        className={`text-xs font-medium ${STATUS_STYLES[tx.status] ?? "text-gray-500"}`}
                      >
                        {STATUS_LABELS[tx.status] ?? tx.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-xs text-gray-900">
                      -{formatAmount(tx.amount)}&nbsp;{tx.currency}
                    </td>
                    <td className="py-3.5 pl-6 pr-4 text-right text-xs text-gray-400">
                      {timeAgo(tx.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
      />

      <CreateAgentKeyModal
        open={createKeyOpen}
        onClose={() => setCreateKeyOpen(false)}
        onCreated={() => {
          void fetchAll();
        }}
      />

      <CardSettingsModal
        open={selectedCard !== null}
        card={selectedCard}
        onClose={() => setSelectedCardId(null)}
        onSaved={() => {
          void fetchAll();
        }}
        onRevoke={handleRevoke}
      />
    </div>
  );
}
