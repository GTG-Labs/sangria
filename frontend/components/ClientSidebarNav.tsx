"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ArrowLeftRight, SlidersHorizontal } from "lucide-react";

const NAV_ITEMS = [
  { href: "/client/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/client/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/client/settings", label: "Balance", icon: SlidersHorizontal },
];

export default function ClientSidebarNav() {
  const pathname = usePathname();

  return (
    <div className="mt-1.5">
      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

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
