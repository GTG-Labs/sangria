import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-white/5 py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Image
              src="/sangrialogo.png"
              alt="Sangria Logo"
              width={28}
              height={28}
              className="w-7 h-7"
              style={{ mixBlendMode: "multiply" }}
            />
            <span className="text-gray-600 dark:text-zinc-400 font-medium">
              Sangria
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-zinc-500">
            <Link
              href="/docs"
              className="hover:text-gray-900 dark:hover:text-zinc-300 transition-colors"
            >
              Documentation
            </Link>
            <Link
              href="https://www.x402.org/"
              className="hover:text-gray-900 dark:hover:text-zinc-300 transition-colors"
            >
              x402.org
            </Link>
            <Link
              href="https://github.com/GTG-Labs/sangria-net"
              className="hover:text-gray-900 dark:hover:text-zinc-300 transition-colors"
            >
              GitHub
            </Link>
          </div>
          <p className="text-xs text-gray-500 dark:text-zinc-600">
            &copy; 2026 Sangria. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
