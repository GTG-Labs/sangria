"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const divider = "border-r border-zinc-200 dark:border-zinc-800";
const baseItem = "px-5 h-full flex items-center text-sm transition-all duration-200 relative";

const links = [
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="hidden md:flex items-stretch border-l border-zinc-200 dark:border-zinc-800">
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={`${baseItem} ${divider} ${
              isActive
                ? "text-gray-900 dark:text-white"
                : "text-zinc-500 dark:text-zinc-400 hover:bg-[rgb(21,21,21)] hover:text-[rgb(234,235,224)]"
            }`}
          >
            {link.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 dark:bg-white" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
