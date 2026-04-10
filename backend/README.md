# Sangria Backend

HTTP API server for x402 crypto payments, merchant management, and double-entry accounting. Built with [Fiber v3](https://gofiber.io/) (Go) and [pgx](https://github.com/jackc/pgx) for Postgres.

## Prerequisites

- Go 1.25+
- A running Postgres instance with the schema already pushed (see [`dbSchema/README.md`](../dbSchema/README.md))
- WorkOS account (for user authentication)
- Coinbase CDP account (for crypto wallet creation)

## Setup

```bash
cp .env.example .env   # fill in all required variables
go run .
```

The server starts on `http://localhost:8080`.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (`sslmode=verify-full&sslrootcert=system`) |
| `WORKOS_API_KEY` | Yes | WorkOS API key |
| `WORKOS_CLIENT_ID` | Yes | WorkOS client ID |
| `WORKOS_TOKEN_ISSUER` | Yes | JWT issuer for validation (e.g., `https://api.workos.com/user_management/<client_id>`) |
| `ALLOWED_ORIGINS` | No | CORS allowed origins, comma-separated (default: `http://localhost:3000`) |
| `CDP_API_KEY` | Yes | Coinbase Developer Platform API key |
| `CDP_API_SECRET` | Yes | CDP API secret |
| `CDP_WALLET_SECRET` | Yes | Encryption key for CDP wallet keys |
| `ADMIN_API_KEY` | Yes | Shared secret for admin endpoints (generate with `openssl rand -hex 32`) |
| `X402_FACILITATOR_URL` | Yes | Facilitator URL (testnet: `https://x402.org/facilitator`) |
| `PLATFORM_FEE_PERCENT` | No | Fee percentage per payment (default: `0`, recommended: `0.5`) |
| `PLATFORM_FEE_MIN_MICROUNITS` | No | Minimum fee in microunits (default: `0`, recommended: `1000` = $0.001) |
| `WITHDRAWAL_AUTO_APPROVE_THRESHOLD` | No | Auto-approve withdrawals up to this amount in microunits (default: `200000000` = $200) |
| `WITHDRAWAL_MIN_AMOUNT` | No | Minimum withdrawal in microunits (default: `1000000` = $1.00) |
| `WITHDRAWAL_FEE_FLAT` | No | Flat fee per withdrawal in microunits (default: `0`) |

## API reference

All routes are organized by auth type. The route prefix indicates the auth pattern.

### Public

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | None | Health check |

### Dashboard endpoints — `/internal/*` (WorkOS JWT)

These are called by the Sangria frontend dashboard. The user logs in via WorkOS and gets a JWT.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/internal/users` | WorkOS JWT | Register/upsert user on login |
| GET | `/internal/transactions` | WorkOS JWT | List merchant transactions (paginated) |
| POST | `/internal/merchants` | WorkOS JWT | Create a merchant API key + USD liability account |
| GET | `/internal/api-keys` | WorkOS JWT | List user's API keys |
| DELETE | `/internal/api-keys/:id` | WorkOS JWT | Revoke an API key |
| POST | `/internal/withdrawals` | WorkOS JWT | Request a merchant withdrawal (requires merchant_id) |
| GET | `/internal/withdrawals` | WorkOS JWT | List withdrawals for a merchant (?merchant_id=) |

### SDK endpoints — `/v1/*` (API key)

These are called by merchant servers using the Sangria SDK. Authenticated via merchant API key.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/generate-payment` | API key | Generate x402 PaymentRequired |
| POST | `/v1/settle-payment` | API key | Verify + settle payment, credit merchant |

### Admin endpoints — `/admin/*` (WorkOS JWT + admin key + admin role)

Triple-gated: requires WorkOS JWT, `X-Admin-Key` header, and `role = "admin"` in the database.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/admin/wallets/pool` | Admin | Create a CDP wallet in the pool |
| POST | `/admin/treasury/fund` | Admin | Record a USD treasury deposit (bookkeeping only) |
| POST | `/admin/withdrawals/:id/approve` | Admin | Approve a pending withdrawal |
| POST | `/admin/withdrawals/:id/reject` | Admin | Reject and reverse a pending withdrawal |
| POST | `/admin/withdrawals/:id/complete` | Admin | Mark withdrawal as completed after bank transfer |
| GET | `/admin/withdrawals` | Admin | List withdrawals (filterable by ?status=) |

### API key format

Merchant API keys follow the format `sg_live_<key_id>_<random>` or `sg_test_<key_id>_<random>`. Pass via `Authorization: Bearer <key>` header.

### Admin authentication

Admin endpoints require all three:
1. `Authorization: Bearer <workos-jwt>` header
2. `X-Admin-Key: <admin-api-key>` header
3. User's `role = "admin"` in the database

All admin auth failures return a generic `403 Forbidden`.

## Project structure

```
backend/
├── main.go                        # Server startup + route registration
├── routes/
│   ├── public.go                  # RegisterPublicRoutes (health check)
│   ├── jwt.go                     # RegisterJWTRoutes (dashboard endpoints, /internal/*)
│   ├── apikey.go                  # RegisterAPIKeyRoutes (SDK endpoints, /v1/*)
│   └── admin.go                   # RegisterAdminRoutes (admin endpoints, /admin/*)
├── config/
│   ├── server.go                  # Environment loading, WorkOS setup, DB connection
│   ├── fees.go                    # Platform fee config + calculation
│   └── withdrawals.go             # Withdrawal config (auto-approve, min amount, fee)
├── auth/
│   ├── middleware.go              # WorkosAuthMiddleware, APIKeyAuthMiddleware, RequireAdmin
│   ├── workos.go                  # JWKS cache, JWT validation, CreateUser handler
│   ├── apiKeyHandlers.go         # ListAPIKeys, DeleteAPIKey handlers
│   ├── keyStore.go                # CreateAPIKey, AuthenticateAPIKey, RevokeAPIKey
│   ├── merchantKeys.go           # API key generation, format validation
│   └── hash.go                    # bcrypt hashing + verification
├── merchantHandlers/
│   ├── payments.go                # GeneratePayment, SettlePayment
│   ├── transactions.go            # GetMerchantTransactions (paginated)
│   └── withdrawals.go             # RequestWithdrawal, ListWithdrawals
├── adminHandlers/
│   ├── merchants.go               # CreateMerchantAPIKey
│   ├── wallets.go                 # CreateWalletPool
│   ├── treasury.go               # FundTreasury
│   └── withdrawals.go             # ApproveWithdrawal, RejectWithdrawal, CompleteWithdrawal
├── dbEngine/
│   ├── models.go                  # All Go types + enums
│   ├── engine.go                  # DB connection pool
│   ├── systemAccounts.go          # System account initialization
│   ├── merchants.go               # GetMerchantByID, EnsureUSDLiabilityAccount
│   ├── cryptoWallets.go           # CreateCryptoWalletWithAccount, GetWalletByNetwork/Address
│   ├── withdrawals.go             # CreateWithdrawal, Approve/Reject/Complete/FailWithdrawal
│   ├── transaction.go             # Double-entry ledger (InsertTransaction, validateZeroNet)
│   ├── users.go                   # User CRUD
│   └── queries.go                 # Transaction queries (paginated)
├── cdpHandlers/
│   └── wallet.go                  # CDP client, wallet creation, faucet funding
├── x402Handlers/
│   ├── facilitator.go             # Facilitator HTTP client (Verify, Settle)
│   └── types.go                   # x402 protocol types, network config map
└── utils/
    ├── cors.go                    # CORS middleware
    └── pagination.go              # Cursor-based pagination helpers
```

## How payments work

1. Merchant's SDK calls `POST /v1/generate-payment` with the price
2. Sangria picks a wallet from the pool and returns an x402 `PaymentRequired` response
3. The client (AI agent) signs an EIP-712 authorization using the x402 SDK
4. Merchant's SDK forwards the signed payload to `POST /v1/settle-payment`
5. Sangria verifies the signature and settles on-chain via the facilitator
6. A cross-currency ledger entry is created:
   - USDC received → Conversion Clearing (bridge) → USD owed to merchant + platform fee
7. Merchant sees their USD balance increase on the dashboard

## How withdrawals work

1. Merchant requests withdrawal from the dashboard (`POST /internal/withdrawals`)
2. Balance is debited immediately (prevents overdraw)
3. If amount <= $200: auto-approved. If > $200: goes to `pending_approval`
4. Admin reviews pending withdrawals via `GET /admin/withdrawals?status=pending_approval`
5. Admin approves or rejects. Rejection reverses the balance debit.
6. After manual bank transfer, admin marks as completed (`POST /admin/withdrawals/:id/complete`)
7. Completion ledger entry moves funds from Withdrawal Clearing to USD Merchant Pool

## Schema-first workflow

The TypeScript Drizzle schema (`dbSchema/schema.ts`) is the source of truth.

1. Edit `dbSchema/schema.ts`
2. Push with `pnpm push` (from `dbSchema/`)
3. Update Go structs in `dbEngine/models.go`
4. Add DB operations in the appropriate `dbEngine/*.go` file
5. Add handlers in the appropriate `*Handlers/` package
6. Wire routes in the appropriate `routes/*.go` file

See [`dbSchema/README.md`](../dbSchema/README.md) for more on the schema workflow.
