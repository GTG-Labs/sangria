"use client";

import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import type { Root, Separator } from "fumadocs-core/page-tree";

function DocsSidebarSeparator({ item }: { item: Separator }) {
  return (
    <div className="flex items-center gap-1.5 mt-6 mb-0.5 px-2 first:mt-0">
      {item.icon && (
        <span className="[&_svg]:size-3 [&_svg]:shrink-0 text-fd-muted-foreground/60">
          {item.icon}
        </span>
      )}
      <span className="text-[0.6875rem] font-semibold uppercase tracking-widest text-fd-muted-foreground/60">
        {item.name}
      </span>
    </div>
  );
}

export default function DocsLayoutClient({
  tree,
  children,
}: {
  tree: Root;
  children: ReactNode;
}) {
  return (
    <DocsLayout
      tree={tree}
      nav={{ enabled: false }}
      themeSwitch={{ enabled: false }}
      sidebar={{
        defaultOpenLevel: 1,
        components: { Separator: DocsSidebarSeparator },
      }}
    >
      {children}
    </DocsLayout>
  );
}
