"use client";

import { useState, useEffect } from "react";
import { X as XIcon, AlertCircle } from "lucide-react";

interface APIKey {
  id: string;
  organization_id: string;
  name: string;
  key_id: string;
  status: "active" | "pending" | "inactive";
  created_at: string;
}

interface WithdrawModalProps {
  merchants: APIKey[];
  balance: number | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
  formatBalance: (microunits: number) => string;
}

export default function WithdrawModal({
  merchants,
  balance,
  onClose,
  onSuccess,
  formatBalance,
}: WithdrawModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const [merchantId, setMerchantId] = useState(
    merchants.length === 1 ? merchants[0].id : ""
  );
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);

    if (!merchantId) {
      setError("Please select a merchant");
      return;
    }

    const dollars = parseFloat(amount);
    if (isNaN(dollars) || dollars <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    const microunits = Math.round(dollars * 1_000_000);

    if (balance !== null && microunits > balance) {
      setError("Amount exceeds available balance");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/backend/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchantId,
          amount: microunits,
          idempotency_key: crypto.randomUUID(),
        }),
      });

      if (response.ok) {
        await onSuccess();
      } else {
        const data = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(data.error || "Failed to create withdrawal");
      }
    } catch {
      setError("Failed to create withdrawal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md mx-4 bg-white rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Request Withdrawal
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {balance !== null && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs font-medium text-gray-500">
                Available Balance
              </p>
              <p className="text-lg font-semibold text-gray-900">
                ${formatBalance(balance)} USD
              </p>
            </div>
          )}

          {merchants.length > 1 && (
            <div>
              <label
                htmlFor="merchant"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Merchant
              </label>
              <select
                id="merchant"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900"
              >
                <option value="">Select a merchant</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {merchants.length === 1 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1.5">
                Merchant
              </p>
              <p className="text-sm text-gray-900">{merchants[0].name}</p>
            </div>
          )}

          <div>
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Amount (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                $
              </span>
              <input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || !amount || !merchantId}
              className="flex-1 px-4 py-2 bg-sangria-500 text-white rounded-md hover:bg-sangria-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {submitting ? "Submitting..." : "Submit Withdrawal"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
