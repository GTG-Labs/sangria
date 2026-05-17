import { withAuth } from "@workos-inc/authkit-nextjs";
import OrganizationMembersContent from "./OrganizationMembersContent";

export default async function OrganizationMembersPage() {
  await withAuth({ ensureSignedIn: true });

  return <OrganizationMembersContent />;
}