"use client";

import ArcadeButton from "@/components/ArcadeButton";

interface ErrorBoundaryProps {
  error: string;
  onRetry: () => void;
  title?: string;
}

export function ErrorBoundary({
  error,
  onRetry,
  title = "Something went wrong"
}: ErrorBoundaryProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F3F4F1] px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-zinc-200 p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-6 bg-red-100 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          {title}
        </h2>

        <p className="text-gray-600 mb-8 leading-relaxed">
          {error}
        </p>

        <div className="space-y-4">
          <ArcadeButton
            onClick={onRetry}
            className="w-full"
          >
            Try Again
          </ArcadeButton>

          <p className="text-sm text-gray-500">
            If the problem persists, please contact support.
          </p>
        </div>
      </div>
    </div>
  );
}