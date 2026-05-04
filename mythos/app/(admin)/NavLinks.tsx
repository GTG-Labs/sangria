"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/transactions", label: "Transactions" },
  { href: "/withdrawals", label: "Withdrawals" },
  { href: "/wallets", label: "Wallets" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-6">
      {NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`text-sm transition-colors ${
              active
                ? "text-accent-soft font-medium"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
