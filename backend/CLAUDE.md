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
- API key format and validation live in `auth/merchantKeys.go` — use the helpers (`GenerateAPIKey(keyType)`, `ValidateAPIKeyFormat`, `ExtractKeyID`, `parseAPIKey`), don't hand-roll parsing. **Exactly two prefixes are accepted:** `sg_merchants_` (merchant API keys) and `sg_agents_` (agent SDK API keys). **Do NOT add a third prefix** without explicit cross-cutting discussion — every new prefix multiplies the validator surface, breaks log-grep assumptions, and forces every downstream key-handling code path to grow a new branch. If you find yourself wanting to add one, propose the change at the architectural level first. The `KeyType` returned by `ValidateAPIKeyFormat` distinguishes merchant vs agent for callers that need to branch. Errors from these helpers wrap one of two sentinels — `ErrInvalidAPIKeyFormat` (any malformed input) or `ErrUnknownKeyType` (programmer passed a `KeyType` that isn't `Merchant` or `Agent` to `GenerateAPIKey`). Both are distinct from `auth.ErrInvalidAPIKey` in `keyStore.go`, which means "well-formed key, no DB match."
- `APIKeyAuthMiddleware` sets these Fiber locals on success:
  - `key_type` (`string`: `"merchant"` | `"agent"`) — neutral, set always; read this when a handler should support both types
  - `organization_id` (`string` UUID) — neutral, set always
  - `merchant_api_key` (`*dbengine.Merchant`) — set when `key_type == "merchant"`
  - `agent_api_key` (`*dbengine.AgentAPIKey`) — set when `key_type == "agent"`; carries the per-key spend caps + agent_name + revoked/expires state
  - `agent_operator` (`*dbengine.AgentOperator`) — set when `key_type == "agent"`; loaded during auth so handlers can read `OrganizationID`, KYC status, etc. without a second DB call
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
- See root `CLAUDE.md` § Non-Negotiable Principles § Security for the API-key-secret-handling rule; refer to `auth/merchantKeys.go::parseAPIKey` as the canonical implementation example.
