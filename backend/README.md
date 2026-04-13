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

The server starts on the port specified by the `PORT` environment variable (required).

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
| POST | `/internal/withdrawals/:id/cancel` | WorkOS JWT | Cancel a pending withdrawal (merchant self-service) |

### SDK endpoints — `/v1/*` (API key)

These are called by merchant servers using the Sangria SDK. Authenticated via merchant API key.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/generate-payment` | API key | Generate x402 PaymentRequired |
| POST | `/v1/settle-payment` | API key | Verify + settle payment, credit merchant |

### Admin endpoints — `/admin/*` (WorkOS JWT + admins table)

Requires WorkOS JWT and the user must exist in the `admins` table.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/me` | Admin | Check admin status (used by Mythos dashboard) |
| POST | `/admin/wallets/pool` | Admin | Create a CDP wallet in the pool |
| POST | `/admin/treasury/fund` | Admin | Record a USD treasury deposit (bookkeeping only) |
| POST | `/admin/withdrawals/:id/approve` | Admin | Approve a pending withdrawal |
| POST | `/admin/withdrawals/:id/reject` | Admin | Reject and reverse a pending withdrawal |
| POST | `/admin/withdrawals/:id/complete` | Admin | Mark withdrawal as completed after bank transfer |
| POST | `/admin/withdrawals/:id/fail` | Admin | Mark withdrawal as failed and reverse balance debit |
| GET | `/admin/withdrawals` | Admin | List withdrawals (filterable by ?status=) |

### API key format

Merchant API keys follow the format `sg_live_<key_id>_<random>` or `sg_test_<key_id>_<random>`. Pass via `Authorization: Bearer <key>` header.

### Admin authentication

Admin endpoints require both:
1. `Authorization: Bearer <workos-jwt>` header
2. User must exist in the `admins` table

Status codes: `401` (missing/invalid JWT), `403` (authenticated but not in admins table), `500` (internal lookup failure).

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
│   ├── transactions.go            # GetMerchantBalance, GetMerchantTransactions (paginated)
│   └── withdrawals.go             # RequestWithdrawal, ListWithdrawals, CancelWithdrawal
├── adminHandlers/
│   ├── merchants.go               # CreateMerchantAPIKey
│   ├── wallets.go                 # CreateWalletPool
│   ├── treasury.go               # FundTreasury
│   └── withdrawals.go             # ApproveWithdrawal, RejectWithdrawal, CompleteWithdrawal, FailWithdrawal
├── dbEngine/
│   ├── models.go                  # All Go types + enums
│   ├── engine.go                  # DB connection pool
│   ├── systemAccounts.go          # System account initialization
│   ├── merchants.go               # GetMerchantByID, EnsureUSDLiabilityAccount
│   ├── cryptoWallets.go           # CreateCryptoWalletWithAccount, GetWalletByNetwork/Address
│   ├── withdrawals.go             # CreateWithdrawal, Approve/Reject/Complete/FailWithdrawal
│   ├── validation.go              # Shared input validation (ValidateAmountAndFee)
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
2. Balance is debited immediately and held in Withdrawal Clearing (prevents overdraw)
3. If amount <= auto-approve threshold ($200 default): auto-approved. Otherwise: `pending_approval`
4. Merchant can self-cancel while pending (`POST /internal/withdrawals/:id/cancel`). Cancellation reverses the balance debit.
5. Admin reviews pending withdrawals via `GET /admin/withdrawals?status=pending_approval`
6. Admin approves (`/approve`) or rejects (`/reject`). Rejection reverses the balance debit.
7. Admin sends the bank transfer manually (outside Sangria)
8. If transfer lands: admin marks as completed (`/complete`). Completion splits the ledger — net amount exits the merchant pool, fee goes to platform revenue.
9. If transfer bounces: admin marks as failed (`/fail`). Failure reverses the balance debit, restoring the merchant's funds.

### Withdrawal lifecycle

```
                          +-----------+
                          |  pending  |
                     +--->| _approval |---+---+
                     |    +-----------+   |   |
                     |         |          |   |
               auto-approve   | approve  |   | merchant cancel
                     |         v          |   | OR admin reject
                     |    +---------+     v   v
                     +--->| approved|  +----------+
                          +---------+  | canceled |
                               |       +----------+
                   bank transfer attempted
                          /          \
                    success          failure
                       v                v
                 +-----------+    +--------+
                 | completed |    | failed |
                 +-----------+    +--------+
```

| Status | Meaning | Ledger state |
|---|---|---|
| `pending_approval` | Awaiting admin review | Merchant debited, clearing credited |
| `approved` | Approved, ready for bank transfer | Same as above |
| `processing` | Bank transfer in progress (future use) | Same as above |
| `completed` | Bank transfer landed | Clearing debited, merchant pool credited (net), fee revenue credited (fee) |
| `failed` | Bank transfer bounced | Debit reversed — merchant credited back, clearing debited |
| `canceled` | Rejected by admin | Debit reversed — merchant credited back, clearing debited |
| `reversed` | Reserved for future use | — |

### Future: automated off-ramp

The current flow requires manual admin action for bank transfers. This is temporary. The target architecture:

1. Merchant requests withdrawal
2. System auto-approves (or flags for review if above threshold)
3. System calls Bridge/ACH provider to initiate the bank transfer
4. Provider sends a webhook — success triggers `CompleteWithdrawal`, failure triggers `FailWithdrawal`

The admin endpoints (approve, reject, complete, fail) remain as manual override controls for when automation breaks, a transfer gets stuck, or compliance needs to intervene.

## Schema-first workflow

The TypeScript Drizzle schema (`dbSchema/schema.ts`) is the source of truth.

1. Edit `dbSchema/schema.ts`
2. Push with `pnpm push:dev` or `pnpm push:prd` (from `dbSchema/`)
3. Update Go structs in `dbEngine/models.go`
4. Add DB operations in the appropriate `dbEngine/*.go` file
5. Add handlers in the appropriate `*Handlers/` package
6. Wire routes in the appropriate `routes/*.go` file

See [`dbSchema/README.md`](../dbSchema/README.md) for more on the schema workflow.
