"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LayoutDashboard, ExternalLink } from "lucide-react";

const navItems = [
  { href: "/dashboard/transactions", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/docs", label: "Docs", icon: ExternalLink, external: true },
];

export default function PortalSidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="mt-8 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isExternal = "external" in item && item.external;
        const isActive =
          !isExternal &&
          (pathname === item.href || pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            target={isExternal ? "_blank" : undefined}
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
  );
}
