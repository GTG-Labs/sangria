# Backend CLAUDE.md

Go orchestration API. Module: `sangria/backend`. Framework: Fiber v3. Database: PostgreSQL via pgx.

## Commands

```bash
go build ./...          # Build (check for compile errors)
go build -o out         # Build production binary (Railway uses this)
go run .                # Run locally (loads .env via godotenv)
go vet ./...            # Static analysis
```

No test suite exists yet. No linter is configured.

## Architecture

Routes are organized by auth type in `routes/`:
- `public.go` — `GET /` health check + `GET /csrf-token` for CSRF token generation
- `jwt.go` — `/internal/*` (WorkOS JWT + CSRF protection) + `/webhooks/workos` + `/accept-invitation`
- `apikey.go` — `/v1/*` (merchant API key auth for SDK settlement)
- `admin.go` — `/admin/*` (WorkOS JWT + admins table)

Handler packages by auth context:
- `auth/` — user/org management, API key CRUD, middleware, CSRF protection
- `adminHandlers/` — withdrawal approval, treasury, invitations, webhooks
- `merchantHandlers/` — payment settlement, transactions, merchant withdrawals

All database queries live in `dbEngine/`. Handlers call dbEngine functions, never raw SQL.

## Conventions

- Startup sequence in `main.go`: load env → load logging → load every other config module → setup WorkOS → connect DB → ensure system accounts → register routes → listen. Logging must load first so subsequent loaders log through the configured `slog` handler.
- All env var reads live in `backend/config/`. Add a new var by extending the appropriate `Config` struct + `LoadXConfig` function; do not add `os.Getenv` calls in handlers, middleware, or utility packages. The grep `os\.Getenv` outside `config/` should always return zero matches.
- API key format and validation live in `auth/merchantKeys.go` — use the helpers (`GenerateAPIKey(keyType)`, `ValidateAPIKeyFormat`, `ExtractKeyID`, `parseAPIKey`), don't hand-roll parsing or new prefix strings. Three prefixes are accepted: `sg_merchants_` (new merchant keys), `sg_agents_` (new agent keys), `sg_live_` (legacy merchant, accepted indefinitely but never freshly generated). The `KeyType` returned by `ValidateAPIKeyFormat` distinguishes merchant vs agent for callers that need to branch.
- `APIKeyAuthMiddleware` sets these Fiber locals on success:
  - `key_type` (`string`: `"merchant"` | `"agent"`) — neutral, set always; read this when a handler should support both types
  - `organization_id` (`string` UUID) — neutral, set always
  - `merchant_api_key` (`*dbengine.Merchant`) — set when `key_type == "merchant"`; kept for backward compatibility with existing readers (`merchantHandlers/payments.go`, `ratelimit/rate_limit.go`). New code should prefer the neutral locals.
  Agent keys currently reject at the auth layer (no backing table yet) — the `KeyTypeAgent` switch branch in the middleware is defensive only.
- All handler functions return `fiber.Handler` (closure over `*pgxpool.Pool`)
- Organization context resolved via `ResolveOrganizationContext()` helper — checks `?org_id=` param, falls back to single membership or personal org
- Facilitator helpers split by idempotency: `doFacilitatorRequestIdempotent` retries on transient failures (use for `Verify`), `doFacilitatorRequestOnce` makes a single attempt (use for `Settle`). Do not retry `Settle` at the HTTP layer — see root CLAUDE.md § Non-Negotiable Principles for why.

## Security

- **CSRF Protection**: Comprehensive protection across all state-changing operations
- **Token Generation**: `GET /csrf-token` endpoint generates cryptographically secure 256-bit tokens using `crypto/rand`
- **Token Storage**: Secure cookies set with `SameSite=Lax` for localhost development, `HTTPOnly=false` for frontend access
- **Validation Middleware**: `auth.CSRFMiddleware()` protects all `/internal/*` routes
- **Token Sources**: Accepts tokens via `X-CSRF-Token` header (preferred) or JSON body `csrf_token` field
- **Security**: Timing-safe comparison via `crypto/subtle.ConstantTimeCompare` prevents timing attacks
- **CORS**: Configured in `utils/cors.go` with credentials support for cross-origin CSRF token cookies
- **Error Handling**: Structured responses with action hints for frontend token refresh on validation failures
- **API key parsing avoids leaks**: `auth/merchantKeys.go::parseAPIKey` is the canonical pattern for any function that takes a secret and validates it — full key in, only the public parts (type, prefix, 8-char `keyID`) out. The 32-char random secret stays in a local variable and is never assigned to a named return or included in any error message. Any new code that handles API keys, signing keys, or similar secrets must follow this discipline. See root `CLAUDE.md` § Non-Negotiable Principles § Security for the full rule.
