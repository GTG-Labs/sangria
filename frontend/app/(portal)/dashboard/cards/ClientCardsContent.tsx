"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { internalFetch } from "@/lib/fetch";
import AgentCard, { type APIKeyIdentity } from "@/components/AgentCard";
import ArcadeButton from "@/components/ArcadeButton";
import CreateAgentKeyModal from "@/components/CreateAgentKeyModal";
import CardSettingsModal, {
  type CardSettings,
} from "@/components/CardSettingsModal";

interface APIKeyView extends APIKeyIdentity {
  maxPerCallMicrounits: string;
  dailyCapMicrounits: string;
  monthlyCapMicrounits: string;
  createdAt: string;
}

// Only the slice we render here — the /agent endpoint returns more (balance,
// trial/paid totals) but this page is card-management-only.
interface AgentInfo {
  apiKeys: APIKeyView[];
}

export default function ClientCardsContent() {
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const initialLoadedRef = useRef(false);

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!initialLoadedRef.current) setLoading(true);
    setError(null);

    try {
      const res = await internalFetch("/api/client/agent", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setError("Failed to load cards");
        return;
      }
      const data = (await res.json()) as AgentInfo;
      if (controller.signal.aborted) return;
      setAgent(data);
      initialLoadedRef.current = true;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to load cards");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  const handleRevoke = useCallback(
    async (keyId: string): Promise<boolean> => {
      try {
        const res = await internalFetch(
          `/api/client/agent/keys/${encodeURIComponent(keyId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          setError("Failed to revoke key");
          return false;
        }
        await fetchAll();
        return true;
      } catch (err) {
        const detail = err instanceof Error ? `: ${err.message}` : "";
        setError(`Failed to revoke key${detail}`);
        return false;
      }
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
  const selectedCard: CardSettings | null = selectedCardId
    ? cards.find((c) => c.id === selectedCardId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Cards</h1>
          <p className="mt-1 text-sm text-gray-500">
            Every active API key your agents can spend from.
            {cards.length > 0 && (
              <span className="ml-1 text-gray-400">({cards.length})</span>
            )}
          </p>
        </div>

        <ArcadeButton
          variant="secondary"
          size="sm"
          onClick={() => setCreateKeyOpen(true)}
        >
          <Plus className="mr-1.5 inline h-4 w-4" />
          New card
        </ArcadeButton>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

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
          {cards.map((k) => (
            <AgentCard key={k.id} apiKey={k} onClick={setSelectedCardId} />
          ))}
        </div>
      )}

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
