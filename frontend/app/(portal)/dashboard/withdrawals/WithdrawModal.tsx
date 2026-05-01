"use client";

import { useState, useEffect, useMemo } from "react";
import { X as XIcon, AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ArcadeButton from "@/components/ArcadeButton";
import { createWithdrawalSchema, type WithdrawalData } from "@/lib/validation";
import { internalFetch } from "@/lib/fetch";

interface WithdrawModalProps {
  selectedOrgId: string;
  balance: number | null;
  onClose: () => void;
  onSuccess: () => Promise<void>;
  formatBalance: (microunits: number) => string;
}

export default function WithdrawModal({
  selectedOrgId,
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

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memoizedResolver = useMemo(() => {
    return zodResolver(createWithdrawalSchema(balance));
  }, [balance]);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<WithdrawalData>({
    resolver: memoizedResolver,
    mode: "onChange",
    defaultValues: {
      amount: "",
    },
  });

  const onSubmit = async (data: WithdrawalData) => {
    setError(null);
    setSubmitting(true);

    const microunits = Math.round(Number(data.amount) * 1_000_000);

    try {
      const response = await internalFetch("/api/backend/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: selectedOrgId,
          amount: microunits,
          idempotency_key: crypto.randomUUID(),
        }),
      });

      if (response.ok) {
        await onSuccess();
      } else {
        const responseData = await response.json().catch(() => ({ error: "Unknown error" }));
        setError(responseData.error || "Failed to create withdrawal");
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

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 pb-6 space-y-4">
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
                {...register("amount")}
                placeholder="0.00"
                className={`w-full pl-7 pr-3 py-2 border rounded-md bg-white text-gray-900 placeholder-gray-400 ${errors.amount ? "border-red-500" : "border-gray-300"
                  }`}
              />
            </div>
            {errors.amount && (
              <p className="mt-1 text-sm text-red-600">{errors.amount.message}</p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <ArcadeButton type="submit" disabled={submitting || !isValid} size="sm" className="flex-1">
              {submitting ? "Submitting..." : "Submit Withdrawal"}
            </ArcadeButton>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
