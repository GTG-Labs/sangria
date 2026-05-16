"use client";

import { useState, useEffect, useRef } from "react";
import { X, CreditCard, CheckCircle } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";

interface SavedCard {
  brand: string;
  last4: string;
}

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
  savedCard: SavedCard | null;
}

const QUICK_AMOUNTS = [10, 25, 50, 100];

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  discover: "Discover",
};

// Inner content unmounts when modal closes, so state resets naturally without useEffect.
function TopUpContent({ onClose, savedCard }: { onClose: () => void; savedCard: SavedCard | null }) {
  const [selectedAmount, setSelectedAmount] = useState<number>(25);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const effectiveAmount = useCustom ? Number(customAmount) || 0 : selectedAmount;
  const brandLabel = savedCard ? (CARD_BRAND_LABEL[savedCard.brand] ?? savedCard.brand) : null;

  const handleConfirm = async () => {
    if (effectiveAmount <= 0) return;
    setConfirming(true);
    // Stub: simulate network latency
    await new Promise((r) => setTimeout(r, 1000));
    setConfirming(false);
    setSuccess(true);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-700 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle className="h-10 w-10 text-green-500" />
            <p className="text-lg font-semibold text-gray-900">Top-up initiated</p>
            <p className="text-sm text-gray-500">
              ${effectiveAmount.toFixed(2)} will arrive as USDC on Base in ~1 minute.
            </p>
            <ArcadeButton variant="secondary" size="sm" onClick={onClose} className="mt-2">
              Done
            </ArcadeButton>
          </div>
        ) : (
          <>
            <h2 className="text-base font-semibold text-gray-900">Top Up Agent</h2>
            <p className="mt-1 text-sm text-gray-500">
              Choose an amount to add to your agent&apos;s USDC balance.
            </p>

            {/* Quick amounts */}
            <div className="mt-4 grid grid-cols-4 gap-2">
              {QUICK_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => { setSelectedAmount(amt); setUseCustom(false); }}
                  className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                    !useCustom && selectedAmount === amt
                      ? "border-sangria-600 bg-sangria-50 text-sangria-700"
                      : "border-zinc-200 text-gray-700 hover:border-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="mt-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <input
                  type="number"
                  min="1"
                  placeholder="Custom"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setUseCustom(true); }}
                  onFocus={() => setUseCustom(true)}
                  className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm outline-none transition-colors ${
                    useCustom
                      ? "border-sangria-600 ring-1 ring-sangria-200"
                      : "border-zinc-200"
                  }`}
                />
              </div>
            </div>

            {/* Payment method */}
            <div className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Payment method
              </p>
              {savedCard ? (
                <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5">
                  <CreditCard className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-700">
                    {brandLabel} ••••&nbsp;{savedCard.last4}
                  </span>
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  {/* Stub card input fields — real Stripe Elements will replace these */}
                  <input
                    type="text"
                    placeholder="Card number"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-sangria-600 focus:ring-1 focus:ring-sangria-200"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="MM / YY"
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-sangria-600 focus:ring-1 focus:ring-sangria-200"
                    />
                    <input
                      type="text"
                      placeholder="CVC"
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-sangria-600 focus:ring-1 focus:ring-sangria-200"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5">
              <ArcadeButton
                onClick={handleConfirm}
                disabled={confirming || effectiveAmount <= 0}
                className="w-full"
                size="sm"
              >
                {confirming
                  ? "Processing..."
                  : `Confirm $${effectiveAmount > 0 ? effectiveAmount.toFixed(2) : "0.00"}`}
              </ArcadeButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TopUpModal({ open, onClose, savedCard }: TopUpModalProps) {
  // ESC key handler lives at the outer shell level so it works even before inner content mounts
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return <TopUpContent onClose={onClose} savedCard={savedCard} />;
}
