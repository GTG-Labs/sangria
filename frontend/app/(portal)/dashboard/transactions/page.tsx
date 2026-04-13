import { withAuth } from "@workos-inc/authkit-nextjs";
import TransactionsContent from "./TransactionsContent";

export default async function TransactionsPage() {
  await withAuth({ ensureSignedIn: true });

  return <TransactionsContent />;
}
