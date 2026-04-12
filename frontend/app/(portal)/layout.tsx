import Image from "next/image";
import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";

import PortalSidebarNav from "@/components/PortalSidebarNav";
import ProfilePopover from "@/components/ProfilePopover";

export default async function PortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = await withAuth({ ensureSignedIn: true });

  return (
    <div className="min-h-screen bg-[#F3F4F1] text-gray-900">
      <div className="flex min-h-screen w-full flex-col lg:flex-row">
        <aside className="border-b border-zinc-200 bg-[#FAFAF8] lg:min-h-screen lg:w-[240px] lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col px-5 pt-5 pb-0">
            <Link href="/" className="flex items-center gap-3 px-2 py-2">
              <Image
                src="/sangrialogo.png"
                alt="Sangria Logo"
                width={34}
                height={34}
                className="h-[34px] w-[34px] rounded-lg"
              />
              <p className="text-sm font-bold text-gray-900">Sangria</p>
            </Link>

            <PortalSidebarNav />

            <div className="mt-auto -mx-5 border-t border-zinc-200 px-3 py-3">
              <ProfilePopover
                firstName={user.firstName}
                lastName={user.lastName}
                email={user.email}
                profilePictureUrl={user.profilePictureUrl}
              />
            </div>
          </div>
        </aside>

        <main className="flex-1 bg-[#F3F4F1]">
          <div className="min-h-screen px-6 py-8 lg:px-10 lg:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
