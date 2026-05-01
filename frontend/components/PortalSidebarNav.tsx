/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, LayoutDashboard, ExternalLink, Users, Wallet } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";

interface NavItem {
  href: string;
  label: string;
  icon: any;
  external?: boolean;
}

export default function PortalSidebarNav() {
  const pathname = usePathname();
  const { selectedOrg } = useOrganization();

  // Generate navigation items based on user role and selected organization
  const getNavItems = (): NavItem[] => {
    const baseItems: NavItem[] = [
      { href: "/dashboard/transactions", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/dashboard/withdrawals", label: "Withdrawals", icon: Wallet },
    ];

    // Add Members tab for all organization members (admins get additional controls within the page)
    if (selectedOrg) {
      baseItems.push({ href: "/dashboard/members", label: "Team", icon: Users });
    }

    baseItems.push({ href: "/docs", label: "Docs", icon: ExternalLink, external: true });

    return baseItems;
  };

  return (
    <div className="mt-3">
      <nav className="space-y-1">
        {getNavItems().map((item) => {
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
              rel={isExternal ? "noopener noreferrer" : undefined}
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
