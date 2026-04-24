@AGENTS.md

## Conventions

- Every backend call from mythos is an admin operation. `mythos/lib/api-proxy.ts` `proxyToBackend` enforces this at the proxy layer via `verifyAdmin()` in addition to the layout-level gate and backend's `RequireAdmin` middleware. If you add a non-admin route in the future, create a separate proxy helper — don't weaken the existing one.
- All `process.env.X` reads live in `lib/env.ts` (Zod-validated via `@t3-oss/env-nextjs`). Import `{ env }` and reference `env.BACKEND_URL` etc. Never read `process.env` directly elsewhere — new env vars go in `lib/env.ts` schema first, then the `runtimeEnv` mapping (Next.js's build-time inlining requires the literal `process.env.NEXT_PUBLIC_X` reference there).
- Proxy routes and paginated list patterns: see root CLAUDE.md § Next.js App Conventions.
