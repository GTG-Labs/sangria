import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{ enabled: false }}
      sidebar={{ defaultOpenLevel: 1 }}
      containerProps={{
        style: {
          "--fd-banner-height": "4rem",
        } as React.CSSProperties,
      }}
    >
      {children}
    </DocsLayout>
  );
}
