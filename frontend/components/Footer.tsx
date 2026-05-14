import Link from "next/link";
import Image from "next/image";

export default function Footer() {
  return (
    <footer className="relative border-t border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-zinc-950 font-sans overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 pt-12 pb-8">
        {/* Links top-right */}
        <div className="flex justify-end mb-10">
          <div className="flex flex-col items-end gap-4">
            <div className="flex items-center gap-5">
              <Link
                href="https://github.com/GTG-Labs/sangria"
                aria-label="GitHub"
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <svg
                  viewBox="0 0 1024 1024"
                  fill="currentColor"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M512 0C229.12 0 0 229.12 0 512c0 226.56 146.56 417.92 350.08 485.76 25.6 4.48 35.2-10.88 35.2-24.32 0-12.16-.64-52.48-.64-95.36-128.64 23.68-161.92-31.36-172.16-60.16-5.76-14.72-30.72-60.16-52.48-72.32-17.92-9.6-43.52-33.28-.64-33.92 40.32-.64 69.12 37.12 78.72 52.48 46.08 77.44 119.68 55.68 149.12 42.24 4.48-33.28 17.92-55.68 32.64-68.48-113.92-12.8-232.96-56.96-232.96-252.8 0-55.68 19.84-101.76 52.48-137.6-5.12-12.8-23.04-65.28 5.12-135.68 0 0 42.88-13.44 140.8 52.48 40.96-11.52 84.48-17.28 128-17.28s87.04 5.76 128 17.28c97.92-66.56 140.8-52.48 140.8-52.48 28.16 70.4 10.24 122.88 5.12 135.68 32.64 35.84 52.48 81.28 52.48 137.6 0 196.48-119.68 240-233.6 252.8 18.56 16 34.56 46.72 34.56 94.72 0 68.48-.64 123.52-.64 140.8 0 13.44 9.6 29.44 35.2 24.32C877.44 929.92 1024 737.92 1024 512 1024 229.12 794.88 0 512 0"
                  />
                </svg>
              </Link>
              <Link
                href="https://x.com/getSangria"
                aria-label="Twitter / X"
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </Link>
              <Link
                href="/docs"
                className="text-sm text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                Docs
              </Link>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">
              &copy; {new Date().getFullYear()} Sangria. All rights reserved.
            </p>
          </div>
        </div>

        {/* Big wordmark with computey overlapping on the left */}
        <div className="relative -mb-3">
          <Image
            src="/computey2.png"
            alt="Computey mascot"
            width={220}
            height={220}
            className="absolute bottom-0 -left-2 h-[75%] w-auto z-10 drop-shadow-lg"
          />
          <Image
            src="/sangria_wordmark_light_background.png"
            alt=""
            aria-hidden="true"
            width={800}
            height={200}
            className="w-full h-auto opacity-[0.08] dark:hidden"
          />
          <Image
            src="/sangria_wordmark_dark_background.png"
            alt=""
            aria-hidden="true"
            width={800}
            height={200}
            className="w-full h-auto opacity-[0.08] hidden dark:block"
          />
        </div>
      </div>
    </footer>
  );
}
