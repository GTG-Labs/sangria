import Link from "next/link";
import Image from "next/image";

import { getCachedAuth, getCachedSignInUrl } from "@/lib/auth";
import ScrollNav from "./ScrollNav";
import ArcadeButton from "./ArcadeButton";
import MobileMenu from "./MobileMenu";
import NavLinks from "./NavLinks";

export default async function Navigation() {
  const [{ user }, signInUrl] = await Promise.all([
    getCachedAuth(),
    getCachedSignInUrl(),
  ]);

  return (
    <ScrollNav>
      <div className="relative w-full h-12 flex items-stretch px-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1.5 shrink-0">
          <Image
            src="/sangrialogo.png"
            alt="Sangria Logo"
            width={32}
            height={32}
            className="w-8 h-8 dark:mix-blend-normal mix-blend-multiply"
          />
          <span className="text-gray-900 dark:text-white text-lg font-bold">
            Sangria
          </span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Nav links with dividers */}
        <NavLinks />

        {/* Right side: Auth */}
        <div className="hidden md:flex items-center pl-4">
          {user ? (
            <ArcadeButton href="/dashboard/api-keys" size="sm">
              Go to Dashboard →
            </ArcadeButton>
          ) : (
            <ArcadeButton href={signInUrl} size="sm">
              Sign In →
            </ArcadeButton>
          )}
        </div>
        <MobileMenu signInUrl={signInUrl} isLoggedIn={!!user} />
      </div>
    </ScrollNav>
  );
}
