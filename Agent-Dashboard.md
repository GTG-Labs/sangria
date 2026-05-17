# Agent Dashboard

The authenticated `/dashboard` route group in `frontend/` is the agent-operator portal — where a developer running an AI agent that spends through Sangria manages their balance, cards, and payment history. The merchant-side surface (for businesses accepting payments) is parked under `_merchant/`; Next.js's leading-underscore convention excludes that folder from routing, so those pages aren't currently reachable.

Lives under `frontend/app/(portal)/dashboard/`. WorkOS-authenticated. All data fetched through the `/api/client/*` proxy routes that forward to the Go backend at `/internal/client/*`.

## Routes

| Path | File | Purpose |
|---|---|---|
| `/dashboard` | `page.tsx` → `ClientDashboardContent.tsx` | Balance, Top Up, New card, recent cards (up to 6), recent payments (up to 5) |
| `/dashboard/cards` | `cards/page.tsx` → `cards/ClientCardsContent.tsx` | Full grid of every active agent card |
| `/dashboard/transactions` | `transactions/page.tsx` → `transactions/ClientTransactionsContent.tsx` | Paginated x402 payment history |

Sidebar nav (`components/ClientSidebarNav.tsx`) exposes Dashboard / Cards / Transactions. The sidebar itself (`components/ResizableSidebar.tsx`) is pinned to the viewport on `lg:` and up, so the profile chip stays bottom-left while the main column scrolls.

## Key components

| Component | What it does |
|---|---|
| `AgentCard` | Renders one API key as a credit-card visual. Click opens `CardSettingsModal`. |
| `CardSettingsModal` | Per-card caps editor (max-per-call, daily, monthly) + revoke action. |
| `CreateAgentKeyModal` | Creates a new agent API key. Shows the secret exactly once. |
| `TopUpModal` | Stripe-powered balance top-up. Opens Elements card form, calls `POST /api/client/topups` to mint a PaymentIntent, then `stripe.confirmCardPayment`. Stripe webhook (`backend/clientHandlers/stripeWebhook.go`) credits the ledger asynchronously on `payment_intent.succeeded`. **Local dev requires `stripe listen --forward-to localhost:8080/webhooks/stripe` — without it the charge succeeds but the balance never updates.** See [backend/README.md § Local development with Stripe](backend/README.md#local-development-with-stripe). |

## Data shape

`GET /internal/client/agent` returns:

```ts
{
  operatorId: string;
  apiKeys: APIKeyView[];           // every active (non-revoked, non-expired) key
  balanceMicrounits: number;       // trial + paid
  trialMicrounits: number;
  paidMicrounits: number;
  stripePublishableKey: string;    // echoed so the frontend doesn't drift
}
```

Backend handler: `backend/clientHandlers/operator.go::GetOrCreateOperator`. Lazy-creates the operator (issues the trial credit on first request).

## State conventions

- All client-side state-changing requests go through `internalFetch` (`lib/fetch.ts`) — auto-injects the CSRF token.
- Paginated list components (transactions) use a shared `useRef<AbortController>` and the `resetForInitialLoadFailure()` pattern (see root `CLAUDE.md` § Next.js App Conventions).
- The dashboard tracks `initialLoadedRef` to avoid flipping back to a full-page spinner on background refetches (which would unmount any open modal mid-flow).

## Recent changes

**2026-05-16**
- Pinned the resizable sidebar to the viewport (`lg:sticky lg:top-0 lg:h-screen`) so the profile chip stays anchored bottom-left when the main column scrolls.
- Added a **Cards** entry to the sidebar nav.
- Capped the dashboard at 6 cards; if more exist, a `View all` link appears next to the section header.
- New page at `/dashboard/cards` rendering the full grid (same `AgentCard` + `CardSettingsModal` flow as the dashboard).
- Fixed the sidebar active-state check so `/dashboard` no longer lights up alongside child routes (`/dashboard/cards`, `/dashboard/transactions`).
