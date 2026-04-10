"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";

export default function GitHubStarChip() {
  const [stars, setStars] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("https://api.github.com/repos/GTG-Labs/sangria-net", {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.stargazers_count != null) setStars(data.stargazers_count);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (dismissed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-zinc-800 text-zinc-200 text-sm font-medium shadow-lg">
      <Link
        href="https://github.com/GTG-Labs/sangria-net"
        target="_blank"
        className="flex items-center gap-2 pl-4 py-2 hover:text-white transition-colors"
      >
        <svg
          viewBox="0 0 1024 1024"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
          />
        </svg>
        {stars !== null && stars.toLocaleString()} ⭐️
      </Link>
      <button
        onClick={() => setDismissed(true)}
        className="pr-3 pl-1 py-2 text-zinc-400 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
