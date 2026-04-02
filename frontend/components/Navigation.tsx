import Link from "next/link";
import Image from "next/image";

import { withAuth, getSignInUrl } from "@workos-inc/authkit-nextjs";
import ScrollNav from "./ScrollNav";
import ArcadeButton from "./ArcadeButton";

async function getStarCount(): Promise<number | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(
      "https://api.github.com/repos/GTG-Labs/sangria-net",
      { next: { revalidate: 3600 }, signal: controller.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.stargazers_count ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function Navigation() {
  const [{ user }, signInUrl, stars] = await Promise.all([
    withAuth(),
    getSignInUrl(),
    getStarCount(),
  ]);

  return (
    <ScrollNav>
      <div className="w-full px-6 h-16 flex items-center">
        <Link href="/" className="flex items-center gap-2 mr-auto">
          <Image
            src="/sangrialogo.png"
            alt="Sangria Logo"
            width={32}
            height={32}
            className="w-8 h-8 dark:mix-blend-normal mix-blend-multiply"
          />
          <span className="text-gray-900 dark:text-white text-lg font-bold">
            sangriaNet
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-gray-600 dark:text-zinc-400">
          <Link
            href="/docs"
            className="hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Docs
          </Link>
          <Link
            href="/blog"
            className="hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Blog
          </Link>
        </div>
        <div className="flex items-center gap-3 ml-8">
          {user ? (
            <ArcadeButton href="/dashboard/api-keys" size="sm">
              Go to Dashboard →
            </ArcadeButton>
          ) : (
            <ArcadeButton href={signInUrl} size="sm">
              Sign In →
            </ArcadeButton>
          )}
          <Link
            href="https://github.com/GTG-Labs/sangria-net"
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="GitHub"
          >
            <svg viewBox="0 0 1024 1024" fill="currentColor" className="w-6 h-6" aria-hidden="true" focusable="false">
              <path fillRule="evenodd" clipRule="evenodd" d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0" />
            </svg>
            {stars !== null && (
              <span className="text-xs font-medium">{stars.toLocaleString()}</span>
            )}
          </Link>
        </div>
      </div>
    </ScrollNav>
  );
}
