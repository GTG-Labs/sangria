"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ArrowLeftRight, CreditCard } from "lucide-react";

// Settings has moved per-card — each card on the dashboard opens its own
// settings modal — so there is no top-level Settings nav entry.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/cards", label: "Cards", icon: CreditCard },
  { href: "/dashboard/transactions", label: "Transactions", icon: ArrowLeftRight },
];

export default function ClientSidebarNav() {
  const pathname = usePathname();

  return (
    <div className="mt-1.5">
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          // `/dashboard` is a prefix of every other nav route, so it would
          // light up on every child page if we used the same startsWith check.
          // Match it exactly; nested routes use the prefix check.
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-zinc-200 text-gray-900"
                  : "text-gray-500 hover:bg-zinc-100 hover:text-gray-900"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
