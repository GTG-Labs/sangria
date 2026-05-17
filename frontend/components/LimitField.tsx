"use client";

interface LimitFieldProps {
  label: string;
  description: string;
  value: string;
  unlimited: boolean;
  allowUnlimited?: boolean; // defaults to true
  onChange: (val: string) => void;
  onUnlimitedChange: (v: boolean) => void;
}

// LimitField is the standard dollar-input row used in card settings and the
// configure step of card creation. It pairs a numeric input with an
// "unlimited" checkbox so a card can opt out of an enforced cap. Internally
// the dashboard maps "unlimited" → JSON null → math.MaxInt64 on the backend
// (schema CHECK constraints reject 0/negative caps, so unlimited cannot be
// stored as a literal zero).
export default function LimitField({
  label,
  description,
  value,
  unlimited,
  allowUnlimited = true,
  onChange,
  onUnlimitedChange,
}: LimitFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs text-gray-400">{description}</p>
        </div>
        {allowUnlimited && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={unlimited}
              onChange={(e) => onUnlimitedChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-gray-400"
            />
            No limit
          </label>
        )}
      </div>
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
          $
        </span>
        <input
          type="number"
          min="0.01"
          step="0.01"
          placeholder="0.00"
          disabled={unlimited}
          value={unlimited ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border py-2 pl-7 pr-3 text-sm outline-none transition-colors ${
            unlimited
              ? "cursor-not-allowed border-zinc-100 bg-zinc-50 text-gray-300"
              : "border-zinc-200 focus:border-sangria-600 focus:ring-1 focus:ring-sangria-200"
          }`}
        />
      </div>
    </div>
  );
}

// Shared microunit ↔ dollar helpers — both modals use these so rounding is
// consistent across the create + edit flows. 1 USD = 1,000,000 microunits.
export function microunitsToDollars(mu: number | string | null): string {
  if (mu === null) return "";
  const microunits = typeof mu === "string" ? parseInt(mu, 10) : mu;
  return (microunits / 1_000_000).toFixed(2);
}

export function dollarsToMicrounits(val: string): number | null {
  const n = parseFloat(val);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 1_000_000);
}
