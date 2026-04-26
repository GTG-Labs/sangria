import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-4xl font-bold text-white">Admin Dashboard</h1>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Link
          href="/newspaper"
          className="group rounded-2xl border border-white/10 bg-zinc-900 p-6 transition hover:border-amber-500/40 hover:bg-zinc-800"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">
            Demo Platform
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            Sangria Gazette
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">
            Open the newspaper paywall demo and walk through the full x402
            subscription flow from the admin experience.
          </p>
          <p className="mt-6 text-sm font-medium text-amber-300 transition group-hover:text-amber-200">
            Launch demo →
          </p>
        </Link>

        <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
            Access
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            Authenticated only
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">
            The dashboard and newspaper demo both live inside the admin route
            group, so only authenticated admins can reach this link.
          </p>
        </div>
      </div>
    </div>
  );
}
