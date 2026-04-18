import Link from "next/link";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { verifyAdmin } from "@/lib/admin";
import { handleSignOut } from "@/lib/auth-actions";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, accessToken } = await withAuth();

  if (!user || !accessToken) {
    redirect("/access-denied");
  }

  const isAdmin = await verifyAdmin(accessToken);
  if (!isAdmin) {
    redirect("/access-denied");
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="border-b border-gray-800">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-8">
            <Link href="/transactions" className="text-lg font-bold">
              mythos
            </Link>
            <div className="flex items-center gap-6">
              <Link
                href="/transactions"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Transactions
              </Link>
              <Link
                href="/withdrawals"
                className="text-sm text-gray-400 hover:text-white transition-colors"
              >
                Withdrawals
              </Link>
            </div>
          </div>
          <form action={handleSignOut}>
            <button
              type="submit"
              className="text-sm text-gray-500 hover:text-white transition-colors"
            >
              Sign Out
            </button>
          </form>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
