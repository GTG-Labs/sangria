import { withAuth } from "@workos-inc/authkit-nextjs";
import WithdrawalsContent from "./WithdrawalsContent";

export default async function WithdrawalsPage() {
  await withAuth({ ensureSignedIn: true });

  return <WithdrawalsContent />;
}
