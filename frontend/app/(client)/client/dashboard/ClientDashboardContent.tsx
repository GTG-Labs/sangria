"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { internalFetch } from "@/lib/fetch";
import AgentCard from "@/components/AgentCard";
import TopUpModal from "@/components/TopUpModal";

interface SavedCard {
  brand: string;
  last4: string;
}

interface AgentInfo {
  walletAddress: string;
  balanceUsdc: number;
  savedCard: SavedCard | null;
}

interface ClientTransaction {
  id: string;
  resource: string;
  amount: number;
  currency: string;
  status: "confirmed" | "pending" | "failed";
  created_at: string;
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

function formatAmount(microunits: number) {
  const dollars = microunits / 1_000_000;
  return dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function timeAgo(dateString: string) {
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
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
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    const fetchAll = async () => {
      setLoading(true);
      setError(null);

      try {
        const [agentRes, txRes] = await Promise.all([
          internalFetch("/api/client/agent", { signal: controller.signal }),
          internalFetch("/api/client/transactions?limit=5", { signal: controller.signal }),
        ]);

        if (controller.signal.aborted) return;

        if (!agentRes.ok || !txRes.ok) {
          setError("Failed to load agent data");
          return;
        }

        const [agentData, txData] = await Promise.all([agentRes.json(), txRes.json()]);
        if (controller.signal.aborted) return;

        setAgent(agentData as AgentInfo);
        setTransactions(((txData.data ?? txData) as ClientTransaction[]).slice(0, 5));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Failed to load agent data");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchAll();

    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Your agent&apos;s balance and recent payments.</p>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {agent && (
        <AgentCard
          walletAddress={agent.walletAddress}
          balanceUsdc={agent.balanceUsdc}
          savedCard={agent.savedCard}
          onTopUp={() => setTopUpOpen(true)}
        />
      )}

      {/* Recent transactions */}
      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Recent Payments</h2>
          <Link
            href="/client/transactions"
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            View all
          </Link>
        </div>

        {transactions.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-gray-400">No payments yet.</p>
            <p className="mt-1 text-xs text-gray-400">
              Your agent&apos;s payments will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="pb-3 pr-6 text-left text-xs font-medium text-gray-400">Resource</th>
                  <th className="pb-3 px-6 text-left text-xs font-medium text-gray-400">Status</th>
                  <th className="pb-3 px-6 text-left text-xs font-medium text-gray-400">Amount</th>
                  <th className="pb-3 pl-6 text-right text-xs font-medium text-gray-400">When</th>
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
                      <span className={`text-xs font-medium ${STATUS_STYLES[tx.status] ?? "text-gray-500"}`}>
                        {STATUS_LABELS[tx.status] ?? tx.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-xs text-gray-900">
                      -{formatAmount(tx.amount)}&nbsp;{tx.currency}
                    </td>
                    <td className="py-3.5 pl-6 pr-4 text-right text-xs text-gray-400">
                      {timeAgo(tx.created_at)}
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
        savedCard={agent?.savedCard ?? null}
      />
    </div>
  );
}
