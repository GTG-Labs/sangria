import { handleSignOut } from "@/lib/auth-actions";

export default function DashboardPage() {
  return (
    <div className="flex h-full items-center justify-center bg-black">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white">mythos</h1>
        <p className="mt-2 text-gray-400">Admin Dashboard</p>
        <form action={handleSignOut} className="mt-8">
          <button
            type="submit"
            className="rounded-lg bg-white px-6 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-200"
          >
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );
}
