import { withAuth, getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import TransactionsContent from "./TransactionsContent";

export default async function TransactionsPage() {
  const { user } = await withAuth();

  if (!user) {
    const signInUrl = await getSignInUrl();
    redirect(signInUrl);
  }

  return <TransactionsContent />;
}
