"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, AlertCircle } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";
import { internalFetch } from "@/lib/fetch";

interface TopUpModalProps {
  open: boolean;
  onClose: () => void;
}

// Quick amounts stored as microunits (int64) for precision-safe handling.
const QUICK_AMOUNTS = [10_000_000, 25_000_000, 50_000_000, 100_000_000];

interface CreateTopupResponse {
  url: string;
  topupId: string;
}

// TopUpModal collects an amount and sends the user to Stripe-hosted Checkout
// for the card flow. No Elements, no CardElement, no Stripe.js loading on
// our origin — Stripe owns the entire card-collection UI. On success Stripe
// redirects the user back to /dashboard?topup=success, where the dashboard
// picks up the query param and refetches the balance.
//
// We accept a single dollar amount, ask the backend to create a Checkout
// Session, and `window.location.href = url` to redirect. The webhook
// (handlers in stripeWebhook.go) credits the ledger asynchronously when
// `payment_intent.succeeded` fires.
export default function TopUpModal({ open, onClose }: TopUpModalProps) {
  // Store amounts as microunits (int64) end-to-end. selectedAmount is one of
  // QUICK_AMOUNTS (already microunits); customAmount stores parsed microunits
  // or null. Format for display only when rendering.
  const [selectedAmount, setSelectedAmount] = useState<number>(25_000_000);
  const [customAmount, setCustomAmount] = useState<number | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Tracks the in-flight checkout-session fetch so closing the modal can
  // cancel it before window.location.href fires or stale state lands.
  const abortRef = useRef<AbortController | null>(null);

  const effectiveAmountMicrounits = useCustom ? customAmount || 0 : selectedAmount;

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, handleClose]);

  // Reset transient state every time the modal closes — no stale "confirming"
  // spinner if the user reopens it after dismissing. Also abort any in-flight
  // checkout-session request so a late redirect can't fire after close.
  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setConfirming(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (effectiveAmountMicrounits <= 0) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setConfirming(true);
    setError(null);

    try {
      const res = await internalFetch("/api/client/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountMicrounits: effectiveAmountMicrounits,
          idempotencyKey: crypto.randomUUID(),
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        if (controller.signal.aborted) return;
        setError(data.error ?? "Failed to start top-up");
        setConfirming(false);
        return;
      }
      const { url } = (await res.json()) as CreateTopupResponse;
      if (controller.signal.aborted) return;
      if (!url) {
        setError("Backend did not return a checkout URL");
        setConfirming(false);
        return;
      }
      // Full-page redirect to Stripe Checkout. We don't pop the modal first
      // because navigating away unmounts everything anyway, and the brief
      // "Redirecting…" state on the button reassures the user a click is in
      // flight.
      window.location.href = url;
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("Top-up failed:", err);
      setError("Top-up failed");
      setConfirming(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="topup-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-xl p-6">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-700 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2
          id="topup-modal-title"
          className="text-base font-semibold text-gray-900"
        >
          Top Up Agent
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose an amount. You&apos;ll be sent to Stripe to enter your card
          and complete payment.
        </p>

        {/* Quick amounts */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((amtMicrounits) => (
            <button
              key={amtMicrounits}
              onClick={() => {
                setSelectedAmount(amtMicrounits);
                setUseCustom(false);
              }}
              className={`rounded-lg border py-2 text-sm font-medium transition-colors ${
                !useCustom && selectedAmount === amtMicrounits
                  ? "border-sangria-600 bg-sangria-50 text-sangria-700"
                  : "border-zinc-200 text-gray-700 hover:border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              ${(amtMicrounits / 1_000_000).toFixed(0)}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="mt-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
              $
            </span>
            <input
              type="number"
              min="1"
              placeholder="Custom"
              value={customAmount !== null ? (customAmount / 1_000_000).toFixed(2) : ""}
              onChange={(e) => {
                const dollarValue = parseFloat(e.target.value);
                if (isFinite(dollarValue) && dollarValue > 0) {
                  setCustomAmount(Math.round(dollarValue * 1_000_000));
                } else {
                  setCustomAmount(null);
                }
                setUseCustom(true);
              }}
              onFocus={() => setUseCustom(true)}
              className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm outline-none transition-colors ${
                useCustom
                  ? "border-sangria-600 ring-1 ring-sangria-200"
                  : "border-zinc-200"
              }`}
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-5">
          <ArcadeButton
            onClick={handleConfirm}
            disabled={confirming || effectiveAmountMicrounits <= 0}
            className="w-full"
            size="sm"
          >
            {confirming
              ? "Redirecting…"
              : `Continue to Stripe · $${effectiveAmountMicrounits > 0 ? (effectiveAmountMicrounits / 1_000_000).toFixed(2) : "0.00"}`}
          </ArcadeButton>
        </div>
      </div>
    </div>
  );
}
