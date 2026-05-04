import Link from "next/link";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { verifyAdmin } from "@/lib/admin";
import { handleSignOut } from "@/lib/auth-actions";
import NavLinks from "./NavLinks";

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
    <div className="min-h-screen bg-page text-fg">
      <nav className="border-b border-white/8">
        <div className="mx-auto max-w-6xl px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/transactions" className="flex items-center gap-1.5 text-lg font-serif">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/mythos_logo.png"
                alt="Mythos"
                width={28}
                height={28}
                className="rounded"
              />
              <span className="translate-y-0.5">Mythos</span>
            </Link>
            <div className="h-5 w-px bg-white/10" />
            <NavLinks />
          </div>
          <form action={handleSignOut}>
            <button
              type="submit"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
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
