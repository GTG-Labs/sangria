import { withAuth } from "@workos-inc/authkit-nextjs";
import APIKeysContent from "./APIKeysContent";

export default async function APIKeysPage() {
  await withAuth({ ensureSignedIn: true });

  return <APIKeysContent />;
}