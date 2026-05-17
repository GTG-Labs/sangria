import { withAuth } from "@workos-inc/authkit-nextjs";

import ClientSidebarNav from "@/components/ClientSidebarNav";
import ProfilePopover from "@/components/ProfilePopover";
import ResizableSidebar from "@/components/ResizableSidebar";

export default async function ClientLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = await withAuth({ ensureSignedIn: true });

  return (
    <div className="min-h-screen bg-[#F3F4F1] text-gray-900">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <ResizableSidebar>
          <div className="px-1.5 pt-1.5 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Agent
            </p>
          </div>

          <div className="-mx-1.5 border-b border-zinc-200 mt-1.5" />

          <ClientSidebarNav />

          <div className="mt-auto -mx-1.5 border-t border-zinc-200 px-1.5 py-3">
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
  );
}
