# Sangria Admin Dashboard (Mythos)

Internal admin dashboard for the Sangria platform. Next.js 16 + WorkOS AuthKit. Listens on port 3001 to keep clear of the merchant frontend on 3000.

Every backend call from this app is an admin operation; the proxy layer (`lib/api-proxy.ts`) enforces this via `verifyAdmin()` in addition to the layout-level gate and the backend's `RequireAdmin` middleware.

## Getting Started

```bash
pnpm install
cp .env.example .env.local   # fill in the variables in the table below
pnpm dev                     # http://localhost:3001
```

Other scripts:

```bash
pnpm build      # Production build
pnpm start      # Run the production build (port 3001)
pnpm lint       # ESLint
```

## Environment Variables

App-managed env vars (those whose `Validated` column is `Yes`) are checked at build time by `lib/env.ts` via `@t3-oss/env-nextjs` + Zod — `pnpm build` fails on any missing or malformed value, so no silent localhost fallbacks reach production. The remaining vars are consumed directly by libraries (e.g. WorkOS AuthKit reads `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` from `process.env` itself).

| Variable                          | Required | Scope  | Validated | Description                                                                                                                                          |
| --------------------------------- | -------- | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKEND_URL`                     | Yes      | Server | Yes       | Go backend base URL (e.g. `https://api.getsangria.com`). Must be a valid URL.                                                                        |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | Yes      | Client | Yes       | WorkOS redirect URI, inlined at build time. Must be a valid URL.                                                                                     |
| `MYTHOS_BASE_URL`                 | No       | Server | Yes       | Override for the public origin used in demo resource URLs (`app/api/x402-pay/route.ts`). When unset, the route derives it from the incoming request. |
| `SANGRIA_SECRET_KEY`              | Yes      | Server | Yes       | Merchant API key used by the x402-pay demo route to authenticate against the backend's `/v1/*` endpoints.                                            |
| `BUYER_ADDRESS`                   | Yes      | Server | Yes       | Buyer EOA address for the x402-pay demo route. Validated as an Ethereum address (`viem.isAddress`) at the call site.                                 |
| `CDP_API_KEY_NAME`                | Yes      | Server | Yes       | Buyer-side Coinbase Developer Platform API key name for signing demo payments. **Not the backend's CDP credentials** — these are buyer/agent-side.   |
| `CDP_API_KEY_PRIVATE_KEY`         | Yes      | Server | Yes       | Buyer-side CDP API private key.                                                                                                                      |
| `CDP_WALLET_SECRET`               | Yes      | Server | Yes       | Buyer-side CDP wallet secret.                                                                                                                        |
| `WORKOS_CLIENT_ID`                | Yes      | Server | No        | WorkOS client ID. Consumed by AuthKit internally; not in `lib/env.ts`.                                                                               |
| `WORKOS_API_KEY`                  | Yes      | Server | No        | WorkOS API key. Consumed by AuthKit internally; not in `lib/env.ts`.                                                                                 |
| `WORKOS_COOKIE_PASSWORD`          | Yes      | Server | No        | 32-byte secret used by AuthKit to encrypt session cookies. Consumed internally.                                                                      |

**Adding a new var:** edit `lib/env.ts` — add it to the appropriate `server` or `client` schema block _and_ to the `runtimeEnv` mapping (Next.js's build-time inlining requires the literal `process.env.NEXT_PUBLIC_X` reference there). Do not add `process.env` reads elsewhere.

## Architecture

- `app/(admin)/` — authenticated admin routes, gated by the layout-level WorkOS check.
- `app/api/admin/*` — proxy routes that forward to the Go backend's `/admin/*` endpoints via `lib/api-proxy.ts`.
- `app/api/x402-pay/route.ts` — internal demo route that exercises the x402 payment flow end-to-end as the buyer.
- `lib/admin.ts` — `verifyAdmin()` helper hitting `GET /admin/me` on the backend.
- `lib/env.ts` — single audit surface for every `process.env` read in this app.
- `proxy.ts` — Next.js middleware (CSP nonce + WorkOS AuthKit).
