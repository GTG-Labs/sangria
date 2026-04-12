import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      <p className="mt-2 text-gray-500">Welcome to Mythos admin.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/transactions"
          className="rounded-lg border border-gray-800 p-6 hover:bg-white/5 transition-colors"
        >
          <h2 className="text-lg font-semibold text-white">Transactions</h2>
          <p className="mt-1 text-sm text-gray-500">
            View all transactions across merchants
          </p>
        </Link>
      </div>
    </div>
  );
}
