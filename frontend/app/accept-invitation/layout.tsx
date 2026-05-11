// Forces the /accept-invitation route to render dynamically per request so the
// nonce-based CSP set by the middleware (proxy.ts) can attach to framework
// scripts. Without this the page is statically prerendered and Next.js can't
// inject the per-request nonce, causing every <script> in the prerendered
// shell to be blocked by 'strict-dynamic' CSP.
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
