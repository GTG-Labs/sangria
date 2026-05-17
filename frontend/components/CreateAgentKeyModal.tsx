"use client";

import { useState, useEffect, useRef } from "react";
import { X, Copy, Check, AlertCircle, KeyRound } from "lucide-react";
import ArcadeButton from "@/components/ArcadeButton";
import LimitField, {
  microunitsToDollars,
  dollarsToMicrounits,
} from "@/components/LimitField";
import { internalFetch } from "@/lib/fetch";

interface CreateAgentKeyModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void; // signals parent to refresh /agent
}

// Default caps prefilled into the configure form. The user adjusts these to
// taste before any key is minted; they are then sent in the POST body so the
// schema CHECKs see real numbers. CHECKs reject 0/negative, so the
// "unlimited" checkbox maps to JSON null → math.MaxInt64 on the backend.
const DEFAULTS = {
  perCallMicrounits: 1_000_000, // $1.00 per call
  dailyMicrounits: 10_000_000, // $10/day
  monthlyMicrounits: 100_000_000, // $100/month
};

interface CreatedKey {
  id: string;
  keyId: string;
  name: string;
  agentName: string;
  apiKey: string; // full secret, only seen once
}

function CreateAgentKeyContent({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  // --- Configure step state ---
  const [name, setName] = useState("Default");
  const [perCall, setPerCall] = useState(
    microunitsToDollars(DEFAULTS.perCallMicrounits),
  );
  const [daily, setDaily] = useState(
    microunitsToDollars(DEFAULTS.dailyMicrounits),
  );
  const [monthly, setMonthly] = useState(
    microunitsToDollars(DEFAULTS.monthlyMicrounits),
  );
  const [perCallUnlimited, setPerCallUnlimited] = useState(false);
  const [dailyUnlimited, setDailyUnlimited] = useState(false);
  const [monthlyUnlimited, setMonthlyUnlimited] = useState(false);

  // --- Submit state ---
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Reveal step state ---
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  // Escape closes only the pre-reveal modal — after creation we force the
  // user through the Done button so they can't dismiss the one-time-secret
  // dialog by accident. Lives in the inner component so it can read
  // `created`; the outer wrapper can't see this state.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !created) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, created]);

  const validate = (): string | null => {
    if (!name.trim()) return "Name is required.";
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

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        maxPerCallMicrounits: perCallUnlimited
          ? null
          : dollarsToMicrounits(perCall),
        dailyCapMicrounits: dailyUnlimited
          ? null
          : dollarsToMicrounits(daily),
        monthlyCapMicrounits: monthlyUnlimited
          ? null
          : dollarsToMicrounits(monthly),
        // requireConfirmAboveMicrounits intentionally omitted — the backend
        // treats nil as "never require confirm", which is the dashboard
        // default. Users can edit it later via the per-card settings modal.
      };
      const res = await internalFetch("/api/client/agent/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: "Unknown error" }));
        setError(data.error ?? "Failed to create card");
        return;
      }
      const data = (await res.json()) as CreatedKey;
      setCreated(data);
      onCreated();
    } catch {
      setError("Failed to create card");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-key-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm overflow-y-auto py-10"
      onClick={(e) => {
        if (e.target === overlayRef.current && !created) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
        {!created && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-gray-400 transition-colors hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {created ? (
          // --- Reveal step ---
          <div>
            <h2
              id="create-key-title"
              className="flex items-center gap-2 text-base font-semibold text-gray-900"
            >
              <KeyRound className="h-4 w-4" />
              Save your API key now
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              This is the only time the full key will be shown. Store it
              somewhere safe — you can&apos;t recover it later.
            </p>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong className="font-semibold">Heads up:</strong> Anyone with
              this key can spend up to your configured caps from your agent
              account.
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Agent name
              </p>
              <p className="mt-1 text-sm text-gray-900">{created.agentName}</p>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                API key
              </p>
              <div className="mt-1 flex items-stretch gap-2">
                <code className="flex-1 break-all rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-gray-900">
                  {created.apiKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="flex items-center justify-center rounded-lg border border-zinc-200 px-3 transition-colors hover:bg-zinc-50"
                  aria-label="Copy key"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-gray-500" />
                  )}
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <ArcadeButton size="sm" onClick={onClose}>
                Done
              </ArcadeButton>
            </div>
          </div>
        ) : (
          // --- Configure step ---
          <div>
            <h2
              id="create-key-title"
              className="text-base font-semibold text-gray-900"
            >
              Configure card
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Set the spend limits for this card. The API key is generated
              once you save — these limits apply to every request made with
              it.
            </p>

            <div className="mt-4">
              <label
                htmlFor="key-name"
                className="text-xs font-medium uppercase tracking-wide text-gray-400"
              >
                Name
              </label>
              <input
                id="key-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Default"
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-sangria-600 focus:ring-1 focus:ring-sangria-200"
              />
            </div>

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

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <ArcadeButton
                size="sm"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Creating…" : "Create card"}
              </ArcadeButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CreateAgentKeyModal({
  open,
  onClose,
  onCreated,
}: CreateAgentKeyModalProps) {
  if (!open) return null;
  return <CreateAgentKeyContent onClose={onClose} onCreated={onCreated} />;
}
