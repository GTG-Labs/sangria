"use client";

import { useEffect, useId, useState } from "react";

export interface ActionDialogField {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "textarea";
  maxLength?: number;
}

interface ActionDialogProps {
  title: string;
  message?: string;
  fields: ActionDialogField[];
  confirmLabel: string;
  confirmVariant: "primary" | "destructive";
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}

export default function ActionDialog({
  title,
  message,
  fields,
  confirmLabel,
  confirmVariant,
  onConfirm,
  onCancel,
}: ActionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const messageId = `${baseId}-message`;
  const fieldId = (name: string) => `${baseId}-${name}`;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const canConfirm = fields.every(
    (f) => !f.required || (values[f.name] ?? "").trim() !== ""
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm(values);
  };

  const confirmClass =
    confirmVariant === "destructive"
      ? "text-red-400 border-red-500/30 hover:bg-red-500/10"
      : "text-green-400 border-green-500/30 hover:bg-green-500/10";

  const inputClass =
    "w-full rounded-lg border border-white/8 bg-elevated px-3 py-2 text-sm text-fg placeholder-zinc-600 focus:border-white/20 focus:outline-none transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="w-full max-w-md rounded-xl border border-white/10 bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 id={titleId} className="text-lg font-semibold text-fg">
              {title}
            </h2>
            <button
              type="button"
              onClick={onCancel}
              className="text-zinc-500 hover:text-fg transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {message && (
            <p id={messageId} className="text-sm text-zinc-400">
              {message}
            </p>
          )}

          {fields.map((field, idx) => {
            const value = values[field.name] ?? "";
            const inputId = fieldId(field.name);
            return (
              <div key={field.name}>
                <label
                  htmlFor={inputId}
                  className="mb-1 block text-xs font-medium text-zinc-500 uppercase tracking-wider"
                >
                  {field.label}
                </label>
                {field.type === "textarea" ? (
                  <textarea
                    id={inputId}
                    value={value}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    rows={3}
                    autoFocus={idx === 0}
                    className={`${inputClass} resize-y`}
                  />
                ) : (
                  <input
                    id={inputId}
                    type="text"
                    value={value}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    autoFocus={idx === 0}
                    className={inputClass}
                  />
                )}
              </div>
            );
          })}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-zinc-400 rounded-md hover:text-fg hover:bg-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              autoFocus={fields.length === 0}
              className={`px-3 py-1.5 text-sm font-medium border rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
