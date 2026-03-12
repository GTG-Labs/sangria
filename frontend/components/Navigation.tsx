import Link from 'next/link';
import Image from 'next/image';
import ThemeToggle from './ThemeToggle';
import { withAuth, getSignInUrl } from '@workos-inc/authkit-nextjs';
import { SignOutButton } from './SignOutButton';

export default async function Navigation() {
  const { user } = await withAuth();
  const signInUrl = await getSignInUrl();

  return (
    <nav className="fixed top-0 w-full z-50 border-b border-gray-200 dark:border-white/5 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/sangrialogo.png"
            alt="Sangria Logo"
            width={32}
            height={32}
            className="w-8 h-8 dark:mix-blend-normal mix-blend-multiply"
          />
          <span className="text-gray-900 dark:text-white font-semibold text-lg">Sangria</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-gray-600 dark:text-zinc-400">
          <Link href="/#how-it-works" className="hover:text-gray-900 dark:hover:text-white transition-colors">How it Works</Link>
          <Link href="/#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">Features</Link>
          <Link href="/#developers" className="hover:text-gray-900 dark:hover:text-white transition-colors">Developers</Link>
          <Link href="/docs" className="hover:text-gray-900 dark:hover:text-white transition-colors">Docs</Link>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-zinc-400">
                {user.email}
              </span>
              <SignOutButton className="text-sm font-medium px-4 py-2 rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">
                Sign Out
              </SignOutButton>
            </div>
          ) : (
            <Link
              href={signInUrl}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-sangria-600 to-indigo-600 text-white hover:opacity-90 transition-opacity"
            >
              Sign In
            </Link>
          )}
          <Link
            href="https://github.com/GTG-Labs/sangria-net"
            className="text-sm font-medium px-4 py-2 rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
          >
            GitHub
          </Link>
        </div>
      </div>
    </nav>
  );
}
