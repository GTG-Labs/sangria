import { withAuth, getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import APIKeysContent from "./APIKeysContent";

// This needs to be a server component for auth check, then render client component
export default async function APIKeysPage() {
  const { user } = await withAuth();

  if (!user) {
    const signInUrl = await getSignInUrl();
    redirect(signInUrl);
  }

  return <APIKeysContent />;
}