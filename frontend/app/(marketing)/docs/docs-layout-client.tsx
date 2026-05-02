"use client";

import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import type { Root, Separator } from "fumadocs-core/page-tree";

function DocsSidebarSeparator({ item }: { item: Separator }) {
  return (
    <div className="mt-6 mb-1 px-2 first:mt-0">
      <span className="text-sm font-bold text-fd-foreground">{item.name}</span>
    </div>
  );
}

export default function DocsLayoutClient({ tree, children }: { tree: Root; children: ReactNode }) {
  return (
    <DocsLayout
      tree={tree}
      nav={{ title: null }}
      themeSwitch={{ enabled: false }}
      sidebar={{
        defaultOpenLevel: 1,
        collapsible: false,
        components: { Separator: DocsSidebarSeparator },
      }}
    >
      {children}
    </DocsLayout>
  );
}
