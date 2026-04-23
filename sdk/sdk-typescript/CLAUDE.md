# TypeScript SDK CLAUDE.md

`@sangria-sdk/core` — merchant-side SDK for protecting API endpoints with x402 payments.

## Commands

```bash
npm run build           # Compile with tsc (outputs to dist/)
npm run dev             # Watch mode (tsc --watch)
```

No test suite or linter is configured.

## Architecture

- `src/core.ts` — `Sangria` client class, handles generate-payment and settle-payment API calls
- `src/adapters/` — framework-specific middleware (express.ts, fastify.ts, hono.ts, nextjs.ts)
- Each adapter exports a `fixedPrice()` helper matching the host framework's conventions.

## Conventions

- Adapters must match host framework idioms: Express uses `(req, res, next)` middleware, Fastify uses `preHandler` hooks, Hono uses `c.set()`
- `bypassPaymentIf(req) => boolean` is wired in at adapter construction and checked per-request before any facilitator call. See root CLAUDE.md § Product Vocabulary for semantics.
- Scheme selection goes through a dedicated helper per scheme, not a union type with a discriminator. `fixedPrice` exposes the `exact` scheme. See root CLAUDE.md § Product Vocabulary for scheme semantics.
- Default base URL points to production (`https://api.getsangria.com`). Override via `baseUrl` constructor option.
- Playground merchants (`playground/merchant-express/`, etc.) are the integration test bed for this SDK — update the relevant example when changing adapter behavior. See root CLAUDE.md § Non-Negotiable Principles for the repo-wide rule.
- Version bumps go in `deployment/SDK_VERSIONS.md`, not `package.json` (CI rewrites `package.json#version` at publish time). See root CLAUDE.md § Non-Negotiable Principles § SDK.
