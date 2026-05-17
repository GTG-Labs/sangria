"use client";

import { useState, useEffect, useRef } from "react";
import { X, AlertCircle, CheckCircle, Trash2 } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";
import LimitField, {
  microunitsToDollars,
  dollarsToMicrounits,
} from "@/components/LimitField";
import { internalFetch } from "@/lib/fetch";

// CardSettings is the per-key shape every interaction needs. The parent
// dashboard already has this data on `apiKey`; we pass it in rather than
// re-fetching so the modal opens instantly with the right values.
export interface CardSettings {
  id: string;
  keyId: string;
  name: string;
  agentName: string;
  maxPerCallMicrounits: string; // math.MaxInt64 sentinel → "unlimited"
  dailyCapMicrounits: string;
  monthlyCapMicrounits: string;
}

interface CardSettingsModalProps {
  open: boolean;
  card: CardSettings | null; // null while no card selected
  onClose: () => void;
  onSaved: () => void; // parent refetches
  // Returns true on success, false on failure. The modal uses this signal to
  // stay open when revoke fails so the user can see the parent's error and
  // either retry or dismiss manually.
  onRevoke: (id: string) => Promise<boolean>;
}

// The backend stores "no limit" as math.MaxInt64 (the schema CHECKs reject
// 0 and negative). Anything close to that means "unlimited" to the user.
// We compare with a generous threshold so a literal int64-max round-trip
// reliably maps back to the unlimited checkbox in the UI.
const UNLIMITED_THRESHOLD = 1_000_000_000_000_000; // 1 quadrillion microunits ≈ $1B

function isUnlimited(microunits: string): boolean {
  const parsed = parseInt(microunits, 10);
  return parsed >= UNLIMITED_THRESHOLD;
}

function CardSettingsContent({
  card,
  onClose,
  onSaved,
  onRevoke,
}: {
  card: CardSettings;
  onClose: () => void;
  onSaved: () => void;
  onRevoke: (id: string) => Promise<boolean>;
}) {
  const [perCall, setPerCall] = useState(() =>
    isUnlimited(card.maxPerCallMicrounits)
      ? ""
      : microunitsToDollars(card.maxPerCallMicrounits),
  );
  const [daily, setDaily] = useState(() =>
    isUnlimited(card.dailyCapMicrounits)
      ? ""
      : microunitsToDollars(card.dailyCapMicrounits),
  );
  const [monthly, setMonthly] = useState(() =>
    isUnlimited(card.monthlyCapMicrounits)
      ? ""
      : microunitsToDollars(card.monthlyCapMicrounits),
  );
  const [perCallUnlimited, setPerCallUnlimited] = useState(() =>
    isUnlimited(card.maxPerCallMicrounits),
  );
  const [dailyUnlimited, setDailyUnlimited] = useState(() =>
    isUnlimited(card.dailyCapMicrounits),
  );
  const [monthlyUnlimited, setMonthlyUnlimited] = useState(() =>
    isUnlimited(card.monthlyCapMicrounits),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  const validate = (): string | null => {
    const pc = perCallUnlimited ? null : dollarsToMicrounits(perCall);
    const d = dailyUnlimited ? null : dollarsToMicrounits(daily);
    const m = monthlyUnlimited ? null : dollarsToMicrounits(monthly);
    if (!perCallUnlimited && pc === null)
      return "Per-call cap must be greater than $0.";
    if (!dailyUnlimited && d === null)
      return "Daily limit must be greater than $0.";
    if (!monthlyUnlimited && m === null)
      return "Monthly limit must be greater than $0.";
    if (d !== null && m !== null && d > m)
      return "Daily limit cannot exceed monthly limit.";
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);

    const payload = {
      maxPerCallMicrounits: perCallUnlimited
        ? null
        : dollarsToMicrounits(perCall),
      dailyCapMicrounits: dailyUnlimited ? null : dollarsToMicrounits(daily),
      monthlyCapMicrounits: monthlyUnlimited
        ? null
        : dollarsToMicrounits(monthly),
    };

    try {
      const res = await internalFetch(
        `/api/client/agent/keys/${encodeURIComponent(card.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: "Unknown error" }));
        setError(data.error ?? "Failed to save settings");
        return;
      }
      setSaved(true);
      onSaved();
      // Briefly flash the "Saved" indicator, then close so the user can
      // see the updated dashboard.
      setTimeout(() => onClose(), 800);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeClick = async () => {
    if (!confirmRevoke) {
      setConfirmRevoke(true);
      setTimeout(() => setConfirmRevoke(false), 4000);
      return;
    }
    const success = await onRevoke(card.id);
    if (success) onClose();
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-10"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-gray-700"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <h2
          id="card-settings-title"
          className="text-base font-semibold text-gray-900"
        >
          Card settings
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          {card.name}{" "}
          <span className="text-gray-400">· {card.agentName}</span>
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <LimitField
            label="Per-call cap"
            description="Max this card can spend on a single request."
            value={perCall}
            unlimited={perCallUnlimited}
            onChange={setPerCall}
            onUnlimitedChange={setPerCallUnlimited}
          />
          <LimitField
            label="Daily limit"
            description="Total this card can spend in a calendar day."
            value={daily}
            unlimited={dailyUnlimited}
            onChange={setDaily}
            onUnlimitedChange={setDailyUnlimited}
          />
          <LimitField
            label="Monthly limit"
            description="Total this card can spend in a calendar month."
            value={monthly}
            unlimited={monthlyUnlimited}
            onChange={setMonthly}
            onUnlimitedChange={setMonthlyUnlimited}
          />
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        {saved && !error && (
          <div className="mt-3 flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Saved
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={handleRevokeClick}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              confirmRevoke
                ? "bg-red-500 text-white hover:bg-red-600"
                : "text-red-600 hover:bg-red-50"
            }`}
            title={
              confirmRevoke ? "Click again to confirm revoke" : "Revoke card"
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
            {confirmRevoke ? "Confirm revoke" : "Revoke card"}
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <ArcadeButton size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </ArcadeButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CardSettingsModal({
  open,
  card,
  onClose,
  onSaved,
  onRevoke,
}: CardSettingsModalProps) {
  // Escape closes the modal — settings edits aren't a one-time secret, so
  // dismissal-by-accident isn't catastrophic here (unlike the create modal).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !card) return null;
  // `card` is passed as the key prop so internal state resets when the user
  // opens settings for a different card without closing the modal in between.
  return (
    <CardSettingsContent
      key={card.id}
      card={card}
      onClose={onClose}
      onSaved={onSaved}
      onRevoke={onRevoke}
    />
  );
}
