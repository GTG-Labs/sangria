import { withAuth } from "@workos-inc/authkit-nextjs";

import OrganizationDropdown from "@/components/OrganizationDropdown";
import PortalSidebarNav from "@/components/PortalSidebarNav";
import ProfilePopover from "@/components/ProfilePopover";
import ResizableSidebar from "@/components/ResizableSidebar";
import { OrganizationProvider } from "@/contexts/OrganizationContext";

export default async function PortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = await withAuth({ ensureSignedIn: true });

  return (
    <OrganizationProvider>
      <div className="min-h-screen bg-[#F3F4F1] text-gray-900">
        <div className="flex min-h-screen w-full flex-col lg:flex-row">
          <ResizableSidebar>
            <OrganizationDropdown />

            <div className="-mx-3 border-b border-zinc-200 mt-3" />

            <PortalSidebarNav />

            <div className="mt-auto -mx-3 border-t border-zinc-200 px-3 py-3">
              <ProfilePopover
                firstName={user.firstName}
                lastName={user.lastName}
                email={user.email}
                profilePictureUrl={user.profilePictureUrl}
              />
            </div>
          </ResizableSidebar>

          <main className="flex-1 bg-[#F3F4F1]">
            <div className="min-h-screen px-6 py-8 lg:px-10 lg:py-10">
              {children}
            </div>
          </main>
        </div>
      </div>
    </OrganizationProvider>
  );
}
