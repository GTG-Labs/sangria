# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product

Sangria (getsangria.com) is payment infrastructure for agentic commerce. Merchants protect API endpoints with the Sangria SDK (~3 lines of code); AI agents pay automatically via the x402 protocol (HTTP 402, EIP-712 typed signing, ERC-3009 USDC transfers). Settlement happens on Base via the Coinbase Facilitator (which sponsors gas — zero fees for agents). Sangria receives USDC on-chain and pays merchants in USD, bridging stablecoin settlement to traditional fiat payouts.

For protocol details see [Sangria-Overview.md](Sangria-Overview.md). For architecture see [Sangria-Architecture.md](Sangria-Architecture.md).

## Repository Map

| Directory | What | Stack |
|---|---|---|
| `backend/` | Orchestration API — accounts, payments, settlement, withdrawals | Go 1.25, Fiber v3, pgx/pgxpool |
| `dbSchema/` | Database schema — single source of truth | Drizzle ORM (TypeScript), PostgreSQL |
| `frontend/` | Docs site + merchant dashboard | Next.js 16, React 19, Tailwind 4 |
| `sdk/sdk-typescript/` | TypeScript merchant SDK (`@sangria-sdk/core`) | TypeScript, adapters for Express/Fastify/Hono |
| `sdk/python/` | Python merchant SDK (`sangria-core`) | Python 3.10+, httpx, FastAPI adapter |
| `playground/` | Example merchant servers + e2e test client | Express, Fastify, Hono, FastAPI, uv |
| `mythos/` | Internal admin dashboard | Next.js 16, WorkOS AuthKit, port 3001 |

Per-package build/test commands are in each package's own CLAUDE.md where one exists. See `backend/CLAUDE.md`, `dbSchema/CLAUDE.md`, `frontend/CLAUDE.md`, `sdk/sdk-typescript/CLAUDE.md`.

## Dev vs Prod Environments

Sangria runs two strictly separated environments — different Postgres databases, different CDP/facilitator endpoints, different WorkOS tenants, different chain contexts (Base Sepolia for dev, Base mainnet for prod).

| Scope | Dev convention | Prod convention |
|---|---|---|
| Backend | Loads `.env` (copy from `.env.example`) | Railway runtime env vars |
| dbSchema | `pnpm push:dev` (loads `.env.dev`) | `pnpm push:prd` (loads `.env.prd`) |
| Frontend | `.env` / `.env.local` | Railway runtime env vars |
| Playground | `.env` with CDP testnet keys, Base Sepolia | Never runs against prod |

**Default is always dev.** `go run .`, `pnpm dev`, and all local commands hit the dev environment. Production configs are for CI/CD and production runtimes only.

**When ambiguous, stop and ask.** If an env file, command, connection string, or config path isn't unambiguously dev, do not run it.

**Never read .env files.** Only read `.env.example` (or equivalent template files). Real env files contain live credentials. Never cat, grep, Read, or otherwise ingest their contents — read the example file instead.

## Product Vocabulary

Use these terms consistently:

- **Payment schemes**: `exact` (fixed price) and `upto` (variable, capped)
- **Bypass**: `bypassPaymentIf` (TS) / `bypass_if` (Python) — skip payment for API-key authenticated callers
- **Facilitator**: the Coinbase-hosted x402 settle endpoint that sponsors gas
- **Settle vs verify**: distinct facilitator operations — verify checks signature/balance/nonce, settle executes the on-chain transfer
- **Ledger**: internal double-entry credit system with idempotent transactions. Source of truth for balances.
- **Microunits**: 1 USD = 1,000,000 microunits. All amounts are int64 microunits, never float64.

## Non-Negotiable Principles

### Schema
- **Schema lives in Drizzle.** Any schema change starts in `dbSchema/schema.ts`. Go code is a consumer, never the author. Never hand-write SQL DDL.
- **Enforce correctness at the database layer** (NOT NULL, unique, FK, CHECK). Never rely on caller discipline.
- Schema conventions (column types, naming, FK rules) live in `dbSchema/CLAUDE.md`.

### Money & Ledger
- **Double-entry bookkeeping for all USDC->USD flows.** Every movement debits and credits named accounts. The ledger is the source of truth for balances.
- **x402 settle is NOT HTTP-idempotent.** Persist intent before calling. Treat ambiguous HTTP responses as UNRESOLVED (not failed) and reconcile against on-chain state. Never release a fiat payout on HTTP 200 alone.
- **EIP-3009 nonces give on-chain idempotency but do not solve HTTP-layer ambiguity.** Don't conflate the two.
- Amount representation is defined in § Product Vocabulary (microunits).

### Code
- **Atomic admin checks.** Permission checks and mutations should be in the same SQL query to prevent TOCTOU races.
- **Email normalization.** Always `strings.TrimSpace(strings.ToLower(email))` before storing or matching.
- **Sentinel errors.** Use package-level `var Err... = errors.New(...)` for typed error handling.

### Security
- **CSRF Protection is automatic.** Frontend components use standard `internalFetch()` calls — never manual CSRF token handling. The fetch wrapper (`lib/fetch.ts`) automatically injects tokens. Backend validates via `auth.CSRFMiddleware()`.
- **Use secure fetch wrapper.** Import `{ internalFetch } from "@/lib/fetch"` instead of global `fetch` for automatic CSRF protection on state-changing requests.

### SDK
- **SDK surface is a product.** Breaking changes to `@sangria-sdk/core` or `sangria-core` need explicit justification.
- Match idioms of each host framework (Express middleware vs Fastify plugin vs FastAPI dependency) rather than forcing a single abstraction.
- Keep TypeScript and Python SDK behavior in lockstep. If you add a feature to one, either add it to the other or explicitly document why it's language-specific.
- When changing SDK behavior, update the relevant playground examples.
- **Bump SDK versions in `deployment/SDK_VERSIONS.md`** — it's the single source of truth. CI auto-bumps the patch version if you forget, but explicit edits communicate intent (patch = fix, minor = feature, major = breaking per semver). Never hand-edit `sdk/sdk-typescript/package.json#version` or `sdk/python/pyproject.toml#version` — CI overwrites them at publish time. See `deployment/DEPLOYMENT.md` for the full flow.

### Process
- Ask clarifying questions before architectural changes.
- Prefer principled reasoning over "what to change" — explain the why.
- Match existing patterns in the codebase; flag inconsistencies rather than silently homogenizing.

## Schema-First Workflow

Schema changes follow a specific workflow — see `dbSchema/CLAUDE.md` § Schema-First Workflow.

## Next.js App Conventions

Applies to both `frontend/` (merchant portal) and `mythos/` (admin dashboard) — both are Next.js 16 apps with server-side proxy routes forwarding to the Go backend. These rules exist because the patterns are easy to get wrong in subtle ways.

### Proxy routes (`app/api/**/route.ts`)

- **URL-encode every dynamic segment** before interpolating into the backend path:
  ```ts
  return proxyToBackend("POST", `/admin/withdrawals/${encodeURIComponent(id)}/approve`, { body });
  ```
  Raw `${id}` lets a caller inject `/` or `..` to reach a different backend route with the authenticated bearer token attached.

- **CSRF Protection**: Pass the request object to `proxyToBackend()` for automatic CSRF token extraction:
  ```ts
  export async function POST(request: Request) {
    const body = await request.json();
    return proxyToBackend("POST", "/internal/organizations", { body }, request);
  }
  ```
  The proxy extracts CSRF tokens from cookies and forwards them to the backend via `X-CSRF-Token` headers.

### Paginated list components

- **Reset list AND pagination metadata on initial-load failure.** Define a `resetForInitialLoadFailure()` helper that clears the list plus `hasMore`, `nextCursor`, `total`, and any aggregate state (e.g., `totals`). Call it from both error paths (response-not-ok and catch), gated by `isInitialLoad`. Load More failures intentionally keep state so retry works. Leaving pagination state stale renders a Load More button below an empty-error screen, which retries with the wrong cursor.
- **One shared `useRef<AbortController>` per paginated fetcher.** Abort the previous controller on each new call (effect, Load More, post-action refetch). Re-check `controller.signal.aborted` after every `await` (fetch + `response.json()` + error-path `response.json().catch()`). Prevents stale responses from clobbering newer state. See `TransactionsContent.tsx` in either app for the canonical pattern.

## CLAUDE.md Hygiene

- Any given instruction, rule, or fact lives in exactly one CLAUDE.md file in this repo. Never duplicate across files.
- Cross-cutting rules (apply repo-wide) live in root CLAUDE.md only.
- Package-specific rules live in that package's CLAUDE.md only.
- When a package-level file needs to reference a cross-cutting rule, link to it by section header (e.g., "see root CLAUDE.md § Non-Negotiable Principles"), don't copy the text.
- Root CLAUDE.md is the only file allowed to have a "Principles" section. Package files contain purpose, commands, package-local conventions, and gotchas — nothing more.
- Before adding any new rule to any CLAUDE.md, grep all CLAUDE.md files in the repo to check if the rule — or a near-variant — already exists. If it does, update the existing location rather than adding a second copy. If there's a genuine conflict, surface it to the user instead of silently picking one.

## Key Reference

- [Backend API reference](backend/README.md) — all endpoints, auth patterns, withdrawal lifecycle
- [Architecture deep-dive](Sangria-Architecture.md) — layered architecture, component breakdown
- [Protocol overview](Sangria-Overview.md) — x402 operations, ERC-3009, settlement flow
- [TypeScript SDK docs](sdk/sdk-typescript/README.md) — all framework adapters, bypass config
- [Python SDK docs](sdk/python/README.md) — FastAPI adapter, API contract
- [Playground](playground/README.md) — example merchants, e2e testing
