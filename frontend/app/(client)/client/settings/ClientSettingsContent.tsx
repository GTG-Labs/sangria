"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";
import { internalFetch } from "@/lib/fetch";
import ArcadeButton from "@/components/ArcadeButton";

interface ClientSettings {
  dailyLimit: number | null;    // microunits; null = no limit
  monthlyLimit: number | null;  // microunits; null = no limit
  perRunCap: number | null;     // microunits; null = no limit
}

function microunitsToDollars(mu: number | null): string {
  if (mu === null) return "";
  return (mu / 1_000_000).toFixed(2);
}

function dollarsToMicrounits(val: string): number | null {
  const n = parseFloat(val);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 1_000_000);
}

interface LimitFieldProps {
  label: string;
  description: string;
  value: string;
  unlimited: boolean;
  onChange: (val: string) => void;
  onUnlimitedChange: (v: boolean) => void;
}

function LimitField({ label, description, value, unlimited, onChange, onUnlimitedChange }: LimitFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="mt-0.5 text-xs text-gray-400">{description}</p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(e) => onUnlimitedChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded accent-gray-400"
          />
          No limit
        </label>
      </div>
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
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

export default function ClientSettingsContent() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [dailyValue, setDailyValue] = useState("");
  const [monthlyValue, setMonthlyValue] = useState("");
  const [perRunValue, setPerRunValue] = useState("");
  const [dailyUnlimited, setDailyUnlimited] = useState(false);
  const [monthlyUnlimited, setMonthlyUnlimited] = useState(false);
  const [perRunUnlimited, setPerRunUnlimited] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    const fetchSettings = async () => {
      try {
        const res = await internalFetch("/api/client/settings", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!res.ok) { setFetchError("Failed to load settings"); return; }
        const data = (await res.json()) as ClientSettings;
        if (controller.signal.aborted) return;
        setDailyUnlimited(data.dailyLimit === null);
        setMonthlyUnlimited(data.monthlyLimit === null);
        setPerRunUnlimited(data.perRunCap === null);
        setDailyValue(microunitsToDollars(data.dailyLimit));
        setMonthlyValue(microunitsToDollars(data.monthlyLimit));
        setPerRunValue(microunitsToDollars(data.perRunCap));
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setFetchError("Failed to load settings");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchSettings();
    return () => controller.abort();
  }, []);

  const validate = (): string | null => {
    const daily = dailyUnlimited ? null : dollarsToMicrounits(dailyValue);
    const monthly = monthlyUnlimited ? null : dollarsToMicrounits(monthlyValue);
    const perRun = perRunUnlimited ? null : dollarsToMicrounits(perRunValue);

    if (!dailyUnlimited && daily === null) return "Daily limit must be greater than $0.";
    if (!monthlyUnlimited && monthly === null) return "Monthly limit must be greater than $0.";
    if (!perRunUnlimited && perRun === null) return "Per-run cap must be greater than $0.";
    if (daily !== null && monthly !== null && daily > monthly)
      return "Daily limit cannot exceed monthly limit.";
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) { setSaveError(validationError); return; }

    setSaving(true);
    setSaveError(null);
    setSaved(false);

    const payload: ClientSettings = {
      dailyLimit: dailyUnlimited ? null : dollarsToMicrounits(dailyValue),
      monthlyLimit: monthlyUnlimited ? null : dollarsToMicrounits(monthlyValue),
      perRunCap: perRunUnlimited ? null : dollarsToMicrounits(perRunValue),
    };

    try {
      const res = await internalFetch("/api/client/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setSaveError((err as { error?: string }).error ?? "Failed to save settings");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setSaveError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Balance</h1>
        <p className="mt-1 text-sm text-gray-500">
          Set spending limits to control how much your agent can spend.
        </p>
      </div>

      {fetchError && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {fetchError}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <LimitField
          label="Daily limit"
          description="Maximum total your agent can spend in a single calendar day."
          value={dailyValue}
          unlimited={dailyUnlimited}
          onChange={setDailyValue}
          onUnlimitedChange={setDailyUnlimited}
        />
        <LimitField
          label="Monthly limit"
          description="Maximum total your agent can spend in a calendar month."
          value={monthlyValue}
          unlimited={monthlyUnlimited}
          onChange={setMonthlyValue}
          onUnlimitedChange={setMonthlyUnlimited}
        />
        <LimitField
          label="Per-run cap"
          description="Maximum your agent can spend on a single payment request."
          value={perRunValue}
          unlimited={perRunUnlimited}
          onChange={setPerRunValue}
          onUnlimitedChange={setPerRunUnlimited}
        />
      </div>

      {saveError && (
        <div className="mt-4 flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      <div className="mt-6 flex items-center gap-4">
        <ArcadeButton onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save changes"}
        </ArcadeButton>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
