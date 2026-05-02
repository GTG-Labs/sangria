import { source } from "@/lib/source";
import type { ReactNode } from "react";
import DocsLayoutClient from "./docs-layout-client";

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsLayoutClient tree={source.getPageTree()}>{children}</DocsLayoutClient>;
}
