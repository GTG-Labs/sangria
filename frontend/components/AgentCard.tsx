"use client";

export interface APIKeyIdentity {
  id: string; // server-side row PK, needed for revoke + settings
  keyId: string; // 8-char public prefix
  name: string;
  agentName: string;
}

interface AgentCardProps {
  apiKey: APIKeyIdentity;
  onClick: (id: string) => void;
}

// AgentCard renders one agent API key as a credit-card visual. Operator-level
// information (balance, saved Stripe card, top-up controls) lives in the
// dashboard header, NOT on each card — every card would otherwise show the
// same balance, which is visually noisy and conceptually wrong (one operator,
// many cards, one pooled balance).
//
// Clicking anywhere on the card opens the per-card settings modal (which is
// also where revoke now lives). The full secret is never available to this
// component — after the one-time reveal in CreateAgentKeyModal, only the
// 8-char keyId survives in storage and we don't even render that.
export default function AgentCard({ apiKey, onClick }: AgentCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(apiKey.id)}
      className="group relative w-full max-w-[340px] rounded-2xl p-6 text-left text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sangria-400 focus-visible:ring-offset-2"
      style={{
        aspectRatio: "1.586",
        background:
          "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #111 100%)",
      }}
      aria-label={`Open settings for card ${apiKey.name}`}
    >
      {/* Top row: Sangria branding + agent handle badge */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Sangria Agent
          </p>
          <p
            className="mt-0.5 text-sm font-medium text-white/80 truncate max-w-[180px]"
            title={apiKey.name}
          >
            {apiKey.name}
          </p>
        </div>
        <span className="rounded-full bg-sangria-600/80 px-2 py-0.5 text-[10px] font-medium text-white/90 whitespace-nowrap">
          {apiKey.agentName}
        </span>
      </div>

      {/* Bottom row: fully masked key. Absolutely positioned at the base of
          the card (like the cardholder line on a physical credit card) so
          cards line up nicely in the grid even if names differ in length. */}
      <div className="absolute bottom-5 left-6 right-6">
        <span className="font-mono text-xs text-white/60">
          •••• •••• •••• ••••
        </span>
      </div>
    </button>
  );
}
