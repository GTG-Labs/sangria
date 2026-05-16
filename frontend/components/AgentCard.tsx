"use client";

import { CreditCard } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";

interface SavedCard {
  brand: string;
  last4: string;
}

interface AgentCardProps {
  walletAddress: string;
  balanceUsdc: number; // microunits
  savedCard: SavedCard | null;
  onTopUp: () => void;
}

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
};

function formatBalance(microunits: number) {
  const dollars = microunits / 1_000_000;
  return dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truncateAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function AgentCard({ walletAddress, balanceUsdc, savedCard, onTopUp }: AgentCardProps) {
  const brandLabel = savedCard ? (CARD_BRAND_LABEL[savedCard.brand] ?? savedCard.brand) : null;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
      {/* Physical card */}
      <div
        className="relative w-full max-w-[340px] rounded-2xl p-6 text-white shadow-lg"
        style={{
          aspectRatio: "1.586",
          background: "linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #111 100%)",
        }}
      >
        {/* Top row */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
              Sangria Agent
            </p>
            <p className="mt-0.5 text-sm font-medium text-white/80">My Agent</p>
          </div>
          <div className="h-8 w-8 rounded-full bg-sangria-600/80" />
        </div>

        {/* Balance */}
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-widest text-white/40">Balance</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">
            ${formatBalance(balanceUsdc)}
            <span className="ml-1.5 text-sm font-normal text-white/50">USDC</span>
          </p>
        </div>

        {/* Bottom row */}
        <div className="absolute bottom-5 left-6 right-6 flex items-end justify-between">
          <p className="font-mono text-xs text-white/60">{truncateAddress(walletAddress)}</p>
          {savedCard ? (
            <div className="flex items-center gap-1.5 text-xs text-white/60">
              <CreditCard className="h-3.5 w-3.5" />
              <span>
                {brandLabel} ••••&nbsp;{savedCard.last4}
              </span>
            </div>
          ) : (
            <span className="text-xs text-white/30">No card saved</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 pt-1">
        <ArcadeButton onClick={onTopUp} size="sm">
          Top Up
        </ArcadeButton>
        <p className="text-xs text-gray-400">
          Funds settle as USDC on Base in ~1 min.
        </p>
      </div>
    </div>
  );
}
