import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { verifyAdmin } from "@/lib/admin";

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

  return <>{children}</>;
}
