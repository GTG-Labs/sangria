"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { handleSignIn } from "@/lib/auth-actions";

interface MobileMenuProps {
  isLoggedIn: boolean;
}

export default function MobileMenu({ isLoggedIn }: MobileMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex md:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-nav"
      >
        {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {open && (
        <div
          id="mobile-nav"
          className="absolute top-16 left-0 right-0 z-50 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-950 shadow-lg"
        >
          <nav className="flex flex-col px-6 py-4 gap-1">
            <Link
              href="/docs"
              onClick={() => setOpen(false)}
              className="py-2.5 text-sm text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Docs
            </Link>
            <Link
              href="/blog"
              onClick={() => setOpen(false)}
              className="py-2.5 text-sm text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Blog
            </Link>
            <div className="pt-2 border-t border-zinc-100 dark:border-white/10 mt-1">
              {isLoggedIn ? (
                <Link
                  href="/dashboard/api-keys"
                  onClick={() => setOpen(false)}
                  className="py-2.5 text-sm font-medium text-sangria-500 hover:text-sangria-600 transition-colors"
                >
                  Go to Dashboard →
                </Link>
              ) : (
                <form action={handleSignIn}>
                  <button
                    type="submit"
                    className="py-2.5 text-sm font-medium text-sangria-500 hover:text-sangria-600 transition-colors"
                  >
                    Sign In →
                  </button>
                </form>
              )}
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
