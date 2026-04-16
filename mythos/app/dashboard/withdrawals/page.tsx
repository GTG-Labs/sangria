import { withAuth } from "@workos-inc/authkit-nextjs";
import AdminWithdrawalsContent from "./AdminWithdrawalsContent";

export default async function AdminWithdrawalsPage() {
  await withAuth({ ensureSignedIn: true });

  return <AdminWithdrawalsContent />;
}
