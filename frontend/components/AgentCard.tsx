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

// Per-card gradient palette. Each card hashes its public keyId to a fixed
// slot, so the same key always renders the same colors across reloads and
// across the dashboard / cards page. Every gradient is dark enough for
// white text to stay readable.
const CARD_PALETTE: { from: string; via: string; to: string }[] = [
  { from: "#7c2d12", via: "#b91c1c", to: "#450a0a" }, // sangria
  { from: "#1e1b4b", via: "#4338ca", to: "#1e293b" }, // indigo
  { from: "#064e3b", via: "#047857", to: "#022c22" }, // emerald
  { from: "#7c2d12", via: "#ea580c", to: "#431407" }, // sunset
  { from: "#2e1065", via: "#6d28d9", to: "#1e1b4b" }, // violet
  { from: "#134e4a", via: "#0f766e", to: "#042f2e" }, // teal
  { from: "#831843", via: "#be123c", to: "#4c0519" }, // rose
  { from: "#0c4a6e", via: "#0369a1", to: "#082f49" }, // sky
];

// djb2-ish hash so the palette slot is stable per keyId. Not security-
// sensitive — we just need an even spread across the 8 gradients.
function paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % CARD_PALETTE.length;
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
  const colors = CARD_PALETTE[paletteIndex(apiKey.keyId)];
  return (
    <button
      type="button"
      onClick={() => onClick(apiKey.id)}
      className="group relative w-full max-w-[340px] overflow-hidden rounded-2xl p-6 text-left text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sangria-400 focus-visible:ring-offset-2"
      style={{
        aspectRatio: "1.586",
        // Layered backgrounds: a top-left "shine" highlight + a bottom-right
        // soft glow, both stacked over the per-card linear gradient. Gives
        // the card a subtle premium-fintech feel without going garish.
        backgroundImage: [
          "radial-gradient(circle at 18% 0%, rgba(255,255,255,0.18) 0%, transparent 45%)",
          "radial-gradient(circle at 95% 100%, rgba(255,255,255,0.08) 0%, transparent 50%)",
          `linear-gradient(135deg, ${colors.from} 0%, ${colors.via} 55%, ${colors.to} 100%)`,
        ].join(", "),
      }}
      aria-label={`Open settings for card ${apiKey.name}`}
    >
      {/* Top row: Sangria branding + agent handle badge */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
            Sangria Agent
          </p>
          <p
            className="mt-0.5 text-sm font-medium text-white/90 truncate max-w-[180px]"
            title={apiKey.name}
          >
            {apiKey.name}
          </p>
        </div>
        <span className="rounded-full bg-white/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-medium text-white/95 ring-1 ring-inset ring-white/20 whitespace-nowrap">
          {apiKey.agentName}
        </span>
      </div>

      {/* Bottom row: fully masked key. Absolutely positioned at the base of
          the card (like the cardholder line on a physical credit card) so
          cards line up nicely in the grid even if names differ in length. */}
      <div className="absolute bottom-5 left-6 right-6">
        <span className="font-mono text-xs tracking-widest text-white/70">
          •••• •••• •••• ••••
        </span>
      </div>
    </button>
  );
}
