# Frontend CLAUDE.md

Next.js 16 docs site + merchant dashboard. Auth via WorkOS AuthKit.

## Commands

```bash
pnpm install            # Install dependencies
pnpm dev                # Dev server (port 3000)
pnpm build              # Production build (standalone output)
pnpm lint               # ESLint
pnpm format             # Prettier
```

## Architecture

- `(portal)/` — authenticated routes, wrapped by `withAuth({ ensureSignedIn: true })` and `OrganizationProvider`
- `(marketing)/` — public pages (docs, blog, landing)
- `api/backend/` — proxy routes that forward to the Go backend via `proxyToBackend()` in `lib/api-proxy.ts`
- `accept-invitation/` — public invitation acceptance page (no auth, token-based)

## ArcadeButton

All action/CTA buttons in the portal must use the `ArcadeButton` component (`components/ArcadeButton.tsx`). It renders a raised 3D "arcade" button with CSS-driven hover/active/disabled states defined in `globals.css` (`btn-raised`, `btn-raised-secondary`, `btn-raised-blue`).

- **Variants**: `primary` (sangria red — default), `secondary` (neutral/light), `blue`
- **Sizes**: `sm`, `md` (default)
- **Usage**: Renders as `<Link>` when `href` is passed, `<button>` otherwise. Supports all standard button/link props (`disabled`, `type`, `onClick`, etc.).
- Cancel/dismiss buttons and small icon-only actions (approve, reject, revoke, delete) are exempt — they stay as plain text/icon buttons for visual hierarchy.

## Conventions

- Backend returns camelCase JSON (`isPersonal`, `isAdmin`). Frontend interfaces must match.
- `OrganizationContext` provides org selection across the dashboard. Pages that fetch org-scoped data should use `selectedOrgId` and include an `AbortController` for race condition safety on org switch.
- `useSearchParams()` must be wrapped in a `<Suspense>` boundary (Next.js 16 requirement for static generation).
- Output mode is `standalone` — production runs via `node .next/standalone/server.js`.
- Proxy routes and paginated list patterns: see root CLAUDE.md § Next.js App Conventions.
- Client-side state-changing requests must go through `internalFetch` (`lib/fetch.ts`), not bare `fetch()`. `internalFetch` auto-attaches the `X-CSRF-Token` header on `POST/PUT/DELETE/PATCH`, fetching the token from `/api/csrf-token` if missing.
- Every env var read by code in this app must be declared in `lib/env.ts` and validated by its Zod schema (via `@t3-oss/env-nextjs`). Import `{ env }` and reference `env.BACKEND_URL` etc. Never read `process.env` directly elsewhere — new env vars go in `lib/env.ts` schema first, then the `runtimeEnv` mapping (Next.js's build-time inlining requires the literal `process.env.NEXT_PUBLIC_X` reference there). **Narrow exception:** third-party libraries (e.g. WorkOS AuthKit reads `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` from `process.env` internally) cannot be routed through the schema; these are listed in `README.md` § Environment Variables with `Validated: No` for operator visibility. Don't invent additional exceptions — if our code touches the value, it goes in `lib/env.ts`.
- Proxy route POST handlers must (1) parse `request.json()` in an isolated try/catch with a specific `"Invalid JSON in … request"` log, (2) reject non-plain-object bodies with `!body || typeof body !== 'object' || Array.isArray(body)`, (3) strip `csrf_token` from the body before forwarding to the Go backend. See `api/backend/organizations/route.ts` for the canonical shape.

## Security

See root CLAUDE.md § Non-Negotiable Principles § Security.
