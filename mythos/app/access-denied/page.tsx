import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { verifyAdmin } from "@/lib/admin";
import { handleSignOut } from "@/lib/auth-actions";

export default async function AccessDeniedPage() {
  const { user, accessToken } = await withAuth();

  // If they're a valid admin, they have no business here
  if (user && accessToken) {
    const isAdmin = await verifyAdmin(accessToken);
    if (isAdmin) {
      redirect("/dashboard");
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-page text-fg">
      <h1 className="mb-4 text-3xl font-bold">Access Denied</h1>
      <p className="mb-8 text-zinc-400">
        You do not have admin privileges to access Mythos.
      </p>
      <form action={handleSignOut}>
        <button
          type="submit"
          className="rounded-lg bg-accent px-6 py-2 text-sm font-medium text-black transition-colors hover:bg-accent-soft"
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
