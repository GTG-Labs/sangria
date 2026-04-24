# Sangria Backend

HTTP API server for x402 crypto payments, merchant management, and double-entry accounting. Built with [Fiber v3](https://gofiber.io/) (Go) and [pgx](https://github.com/jackc/pgx) for Postgres.

## Prerequisites

- Go 1.25+
- A running Postgres instance with the schema already pushed (see [`dbSchema/README.md`](../dbSchema/README.md))
- WorkOS account (for user authentication)
- Coinbase CDP account (for crypto wallet creation)
- Resend account (for invitation emails)

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
| `WORKOS_WEBHOOK_SECRET` | Yes | WorkOS webhook signing secret for validating webhook requests |
| `RESEND_API_KEY` | Yes | Resend API key for sending invitation emails |
| `RESEND_FROM_EMAIL` | Yes | Email address used as sender for Resend invitation emails |
| `FRONTEND_URL` | Yes | Public URL of frontend application (used to build invitation accept links) |
| `ALLOWED_ORIGINS` | No | CORS allowed origins, comma-separated (default: `http://localhost:3000`) |
| `CDP_API_KEY` | Yes | Coinbase Developer Platform API key |
| `CDP_API_SECRET` | Yes | CDP API secret |
| `CDP_WALLET_SECRET` | Yes | Encryption key for CDP wallet keys |
| `X402_FACILITATOR_URL` | Yes | Facilitator URL (testnet: `https://x402.org/facilitator`) |
| `PLATFORM_FEE_PERCENT` | No | Fee percentage per payment (default: `0`, recommended: `0.5`) |
| `PLATFORM_FEE_MIN_MICROUNITS` | No | Minimum fee in microunits (default: `0`, recommended: `1000` = $0.001) |
| `PAYMENT_MAX_MICROUNITS` | No | Max value accepted for a single payment in microunits (default: `1000000000000` = $1,000,000). Rejected at handler before fee math. |
| `WITHDRAWAL_AUTO_APPROVE_THRESHOLD` | No | Auto-approve withdrawals up to this amount in microunits (default: `200000000` = $200) |
| `WITHDRAWAL_MIN_AMOUNT` | No | Minimum withdrawal in microunits (default: `1000000` = $1.00) |
| `WITHDRAWAL_FEE_FLAT` | No | Flat fee per withdrawal in microunits (default: `0`) |

## API reference

All routes are organized by auth type. The route prefix indicates the auth pattern.

### Public

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | None | Health check |
| POST | `/webhooks/workos` | None | WorkOS webhook endpoint (invitation.accepted) |
| POST | `/accept-invitation` | Token | Accept organization invitation via secure token |

### Dashboard endpoints — `/internal/*` (WorkOS JWT)

These are called by the Sangria frontend dashboard. The user logs in via WorkOS and gets a JWT. All endpoints support organization context via `?org_id=` or `?organization_id=` query parameters.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/internal/users` | WorkOS JWT | Register/upsert user on login |
| GET | `/internal/balance` | WorkOS JWT | Get organization USD balance |
| GET | `/internal/transactions` | WorkOS JWT | List organization transactions (paginated) |
| POST | `/internal/merchants` | WorkOS JWT | Create a merchant API key + USD liability account |
| GET | `/internal/api-keys` | WorkOS JWT | List organization's API keys |
| DELETE | `/internal/api-keys/:id` | WorkOS JWT | Revoke an API key |
| POST | `/internal/api-keys/:id/approve` | WorkOS JWT + Admin | Approve a pending API key (organization admin only) |
| POST | `/internal/api-keys/:id/reject` | WorkOS JWT + Admin | Reject a pending API key (organization admin only) |
| POST | `/internal/withdrawals` | WorkOS JWT | Request a merchant withdrawal (requires merchant_id) |
| GET | `/internal/withdrawals` | WorkOS JWT | List withdrawals for a merchant (?merchant_id=) |
| POST | `/internal/withdrawals/:id/cancel` | WorkOS JWT | Cancel a pending withdrawal (merchant self-service) |
| GET | `/internal/organizations/:id/members` | WorkOS JWT | List organization members |
| DELETE | `/internal/organizations/:id/members/:userId` | WorkOS JWT + Admin | Remove a member from organization (admin only) |
| POST | `/internal/organizations/:id/invitations` | WorkOS JWT + Admin | Send Resend invitation to join organization |

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
| GET | `/admin/transactions` | Admin | List all transactions across all merchants (paginated, ?limit=&cursor=&search=&organization_id=&start_date=&end_date=) |
| GET | `/admin/transactions/:id/ledger` | Admin | Get ledger entries for a transaction with account details |
| POST | `/admin/wallets/pool` | Admin | Create a CDP wallet in the pool |
| POST | `/admin/treasury/fund` | Admin | Record a USD treasury deposit (bookkeeping only) |
| POST | `/admin/withdrawals/:id/approve` | Admin | Approve a pending withdrawal |
| POST | `/admin/withdrawals/:id/reject` | Admin | Reject and reverse a pending withdrawal |
| POST | `/admin/withdrawals/:id/complete` | Admin | Mark withdrawal as completed after bank transfer |
| POST | `/admin/withdrawals/:id/fail` | Admin | Mark withdrawal as failed and reverse balance debit |
| GET | `/admin/withdrawals` | Admin | List withdrawals across all merchants (paginated, ?limit=&cursor=&status=) |

### API key format

Merchant API keys follow the format `sg_live_<key_id>_<random>` or `sg_test_<key_id>_<random>`. Pass via `Authorization: Bearer <key>` header.

### Admin authentication

Admin endpoints require both:
1. `Authorization: Bearer <workos-jwt>` header
2. User must exist in the `admins` table

Status codes: `401` (missing/invalid JWT), `403` (authenticated but not in admins table), `500` (internal lookup failure).

## Organization System

Sangria uses a multi-tenant organization system where users can belong to multiple organizations with different permission levels.

### Organization Model

- **Organizations**: Main business entities that own accounts, API keys, and transactions
- **Organization Members**: Junction table linking users to organizations with admin status
- **Personal Organizations**: Each user automatically gets a personal organization
- **Organization Invitations**: Resend-based invitation system for adding users to organizations

### Organization Resolution

All dashboard endpoints automatically resolve the organization context using this priority:

1. **Explicit parameter**: `?org_id=` or `?organization_id=` (validated against user's memberships)
2. **Single membership**: If user belongs to only one organization, use that
3. **Personal organization**: If user has multiple memberships, default to their personal organization
4. **Error**: If user has multiple memberships and no personal org, require explicit parameter

### API Key Approval Workflow

API keys have three statuses: `active`, `pending`, `inactive`.

- **Organization admins**: Create API keys with `active` status immediately
- **Organization members**: Create API keys with `pending` status requiring admin approval
- **Cross-organization security**: Admins can only approve/reject keys within their own organizations

API key creation flow:
1. User creates API key via `POST /internal/merchants`
2. If user is admin of target organization → Status: `active` (immediate use)
3. If user is member of target organization → Status: `pending` (awaits approval)
4. Organization admins can approve/reject pending keys via `/internal/api-keys/:id/approve|reject`

## Project structure

```text
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
│   ├── organization.go            # ResolveOrganizationContext helper (eliminates duplication)
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
│   ├── apiKeyApproval.go          # ApproveAPIKey, RejectAPIKey (organization-scoped)
│   ├── wallets.go                 # CreateWalletPool
│   ├── treasury.go               # FundTreasury
│   ├── withdrawals.go             # ApproveWithdrawal, RejectWithdrawal, CompleteWithdrawal, FailWithdrawal
│   ├── invitations.go             # CreateOrganizationInvitation (Resend integration), AcceptOrganizationInvitation (token-based)
│   └── webhooks.go                # HandleWorkOSWebhook (invitation.accepted)
├── dbEngine/
│   ├── models.go                  # All Go types + enums
│   ├── engine.go                  # DB connection pool
│   ├── systemAccounts.go          # System account initialization
│   ├── users.go                   # User CRUD, GetUserOrganizations, GetUserPersonalOrgID
│   ├── organizations.go           # Organization management (CreateOrganization, AddUserToOrganization, invitations, etc.)
│   ├── merchants.go               # GetMerchantByID, EnsureUSDLiabilityAccount
│   ├── cryptoWallets.go           # CreateCryptoWalletWithAccount, GetWalletByNetwork/Address
│   ├── withdrawals.go             # CreateWithdrawal, Approve/Reject/Complete/FailWithdrawal
│   ├── validation.go              # Shared input validation (ValidateAmountAndFee)
│   ├── transaction.go             # Double-entry ledger (InsertTransaction, validateZeroNet)
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

```text
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

## Organization Invitation System

Sangria uses a hybrid approach for organization invitations:

### Architecture
- **Authentication**: WorkOS handles user authentication and JWT tokens
- **Email Delivery**: Resend sends beautiful HTML invitation emails
- **Business Logic**: Sangria manages invitation tokens, organization membership, and approval workflow

### Invitation Flow
1. Organization admin creates invitation via dashboard (`POST /internal/organizations/:id/invitations`)
2. System generates secure invitation token and stores in `organization_invitations` table
3. Resend sends beautiful HTML email with invitation link to recipient
4. Recipient clicks invitation link and accepts without authentication (`POST /accept-invitation`)
5. System marks invitation as accepted and waits for user to sign in
6. When user signs in via WorkOS, frontend calls (`POST /internal/users`)
7. System automatically processes accepted invitations and adds user to organizations

### Technical Implementation
- **Email Normalization**: Both invitation creation and processing normalize emails to lowercase for consistent matching
- **Connection Pool Management**: Invitation processing uses individual pool operations to avoid transaction conflicts
- **Error Resilience**: Failed invitations are logged but don't prevent processing of other invitations
- **Automatic Processing**: No manual intervention required - invitations are processed on user login

### Security Features
- **Token-based Authentication**: Secure invitation tokens provide authentication for acceptance
- **PII Protection**: All logging masks sensitive data (emails, tokens, URLs) for security
- **Email Validation**: RFC 5322 compliant email validation using stdlib `net/mail`
- **Token Expiration**: Invitations automatically expire after 7 days
- **Rate Limiting**: Duplicate invitation prevention via database constraints

### Troubleshooting
- **"conn busy" errors**: Fixed by removing transactions from invitation processing
- **Email case mismatches**: Fixed by normalizing emails to lowercase in both creation and processing
- **Missing organization membership**: Check that `/internal/users` endpoint is called after WorkOS login

### Permission Model
- **View Members**: All organization members can view the member list
- **Invite Members**: Only organization admins can send invitations
- **Remove Members**: Only organization admins can remove other members
- **Self-removal**: Members can leave organizations (except personal organizations)

## Member Management

Organization members have two permission levels:

### Admin Permissions
- Create API keys with `active` status (immediate use)
- Approve/reject pending API keys from organization members
- Invite new members to organization
- Remove existing members from organization
- All member permissions (below)

### Member Permissions
- Create API keys with `pending` status (requires admin approval)
- View organization balance and transactions
- Request withdrawals from organization accounts
- View all organization members
- Cancel their own pending withdrawals

## Schema-first workflow

The TypeScript Drizzle schema (`dbSchema/schema.ts`) is the source of truth.

1. Edit `dbSchema/schema.ts`
2. Push with `pnpm push:dev` or `pnpm push:prd` (from `dbSchema/`)
3. Update Go structs in `dbEngine/models.go`
4. Add DB operations in the appropriate `dbEngine/*.go` file
5. Add handlers in the appropriate `*Handlers/` package
6. Wire routes in the appropriate `routes/*.go` file

See [`dbSchema/README.md`](../dbSchema/README.md) for more on the schema workflow.
