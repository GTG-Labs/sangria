# Sangria DB Schema

The single source of truth for the database structure. Uses [Drizzle ORM](https://orm.drizzle.team/) to define tables in TypeScript and push them directly to Postgres.

The Go backend does **not** run migrations — it expects these tables to already exist. You define schema here, push it, then write matching Go structs in `backend/dbEngine/`.

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/)
- A running Postgres instance

## Setup

```bash
pnpm install
```

Create `.env.dev` and `.env.prd` with your PlanetScale connection strings (see `.env.example` for format):

```bash
# .env.dev
DATABASE_URL=postgres://user:pass@dev-host:5432/dbname?sslmode=require

# .env.prd
DATABASE_URL=postgres://user:pass@prd-host:5432/dbname?sslmode=require
```

## Commands

| Command | What it does |
|---|---|
| `pnpm push` | Push schema to **dev** (default) |
| `pnpm push:dev` | Push schema to dev |
| `pnpm push:prd` | Push schema to prod |
| `pnpm generate` | Generate migration SQL files (saved to `./drizzle/`) |
| `pnpm studio` | Open Drizzle Studio for **dev** (default) |
| `pnpm studio:dev` | Open Drizzle Studio for dev |
| `pnpm studio:prd` | Open Drizzle Studio for prod |

`pnpm push` compares `schema.ts` against the live database and applies any differences. It defaults to the dev environment.

## Current schema

Defined in `schema.ts`. All tables use UUID primary keys with `defaultRandom()`.

### Enums

| Enum | Values |
|---|---|
| `transaction_status` | pending, confirmed, failed |
| `direction` | DEBIT, CREDIT |
| `currency` | USD, USDC, ETH |
| `account_type` | ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE |
| `network` | base, base-sepolia, polygon, solana, solana-devnet |
| `withdrawal_status` | pending_approval, approved, processing, completed, failed, reversed, canceled |
| `api_key_status` | active, pending, inactive |
| `invitation_status` | pending, accepted, declined, expired |

### Core Tables

**organizations** — multi-tenant business entities

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | varchar(255) | Organization name |
| is_personal | boolean | True for auto-created personal orgs |
| created_at | timestamp (tz) | Default now() |

**users** — WorkOS identities

| Column | Type | Notes |
|---|---|---|
| workos_id | text | Primary key |
| owner | text | Display name or email |
| created_at | timestamp (tz) | Default now() |
| updated_at | timestamp (tz) | Default now() |

**organization_members** — user-organization relationships

| Column | Type | Notes |
|---|---|---|
| user_id | text | FK → users.workos_id |
| organization_id | uuid | FK → organizations.id |
| is_admin | boolean | Admin permissions within org |
| joined_at | timestamp (tz) | When user joined org |

Primary key: `(user_id, organization_id)` — users can only be in each organization once.

**organization_invitations** — two-phase invitation processing

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| organization_id | uuid | FK → organizations.id |
| inviter_user_id | text | FK → users.workos_id (admin who sent invite) |
| invitee_email | varchar(255) | Email being invited |
| invitee_user_id | text | FK → users.workos_id (set when user exists and is added to org) |
| status | invitation_status | pending, accepted, declined, expired |
| message | text | Optional welcome message |
| invitation_token | varchar(255) | Secure token for email links |
| expires_at | timestamp (tz) | 7 days from creation |
| created_at | timestamp (tz) | Default now() |
| accepted_at | timestamp (tz) | When invitation was accepted |
| declined_at | timestamp (tz) | When invitation was declined |

**Two-Phase Invitation Flow**:
1. **Accept**: User accepts invitation via token-only flow (`POST /accept-invitation`). System marks as `status='accepted'` without requiring user details upfront.
2. **Process**: When user signs in via WorkOS, `ProcessAcceptedInvitations` automatically finds accepted invitations with `invitee_user_id IS NULL`, adds user to organizations, and sets `invitee_user_id` to complete the flow.

**Technical Notes**:
- Email normalization: All emails stored as lowercase for consistent matching
- Connection management: Processing uses pool operations instead of transactions to avoid "conn busy" errors
- Error handling: Failed invitation processing is logged but doesn't block user creation
- Security: Invitation tokens, URLs, and emails are masked in all log output

**admins** — access control list for Sangria staff

| Column | Type | Notes |
|---|---|---|
| user_id | text | Primary key, FK → users.workos_id |
| created_at | timestamp (tz) | Default now() |

### Financial Engine

**accounts** — double-entry ledger accounts

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | varchar(255) | Account name |
| type | account_type | ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE |
| currency | currency | USD, USDC, ETH |
| organization_id | uuid | FK → organizations.id (nullable) |
| created_at | timestamp (tz) | Default now() |

**transactions** — idempotency envelopes for ledger writes

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| idempotency_key | varchar(255) | NOT NULL, UNIQUE |
| status | transaction_status | Default 'confirmed' (pending, confirmed, failed) |
| tx_hash | varchar(255) | Nullable, blockchain tx hash (set on confirm) |
| created_at | timestamp (tz) | Default now() |

**ledger_entries** — append-only journal lines

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| transaction_id | uuid | FK → transactions.id |
| currency | currency | Must match account currency |
| amount | bigint | Microunits, CHECK > 0 |
| direction | direction | DEBIT or CREDIT |
| account_id | uuid | FK → accounts.id |

### Business Operations

**merchants** — API keys for x402 payments

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| organization_id | uuid | FK → organizations.id |
| api_key | text | bcrypt hash of full key |
| key_id | varchar(8) | For O(1) indexed lookup |
| name | varchar(255) | Human-readable name |
| status | api_key_status | active, pending, inactive (default: active) |
| last_used_at | timestamp (tz) | Nullable |
| created_at | timestamp (tz) | Default now() |

Constraints: Unique API key, indexed by organization and key_id.

**crypto_wallets** — Sangria-owned CDP wallet pool

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| address | varchar(255) | On-chain address |
| network | network | Which chain |
| account_id | uuid | FK → accounts.id (USDC ASSET) |
| last_used_at | timestamp (tz) | For LRU selection, default epoch |
| created_at | timestamp (tz) | Default now() |

Constraints: `UNIQUE(address, network)`, `UNIQUE(account_id)`

**withdrawals** — merchant payout requests

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| merchant_id | uuid | FK → merchants.id |
| amount | bigint | Microunits, CHECK > 0 |
| fee | bigint | Fee deducted |
| net_amount | bigint | amount - fee |
| status | withdrawal_status | Default pending_approval |
| debit_transaction_id | uuid | FK → transactions.id |
| completion_transaction_id | uuid | FK → transactions.id |
| reversal_transaction_id | uuid | FK → transactions.id |
| failure_code | varchar(100) | Nullable |
| failure_message | text | Nullable |
| reviewed_by | text | Admin who approved/rejected |
| reviewed_at | timestamp (tz) | When approved/rejected |
| review_note | text | Optional admin note |
| completed_by | text | Admin who completed the withdrawal |
| failed_by | text | Admin who marked the withdrawal as failed |
| idempotency_key | varchar(255) | UNIQUE |
| created_at + per-status timestamps | timestamp (tz) | approved_at, completed_at, etc. |

## Multi-Tenancy Architecture

Sangria uses an organization-based multi-tenancy model:

### Organization Structure
- **Organizations** are the main business entities
- **Users** can belong to multiple organizations with different roles
- **Personal Organizations** are auto-created for each user (is_personal=true)
- **Organization Admins** can manage API keys and invite other users

### Access Control
- **API Keys** belong to organizations, not individual users
- **Accounts** and **Transactions** are scoped to organizations
- **Admins** (Sangria staff) have cross-organization access
- **Organization Members** can be regular users or admins within that org

### Data Isolation
All business data is scoped to organizations:
- Merchants (API keys) → organization_id
- Accounts → organization_id
- Crypto Wallets → account_id → organization_id
- Withdrawals → merchant_id → organization_id

### API Key Workflow
1. **Creation**: Users create API keys within an organization context
2. **Status**: Admin users get `active` keys immediately, members get `pending` keys
3. **Approval**: Organization admins can approve/reject `pending` keys from their org
4. **Security**: Cross-organization approval is prevented at the database and application level

## Updating the schema

1. Edit `schema.ts` — add/modify tables using [Drizzle's column types](https://orm.drizzle.team/docs/column-types/pg)
2. Run `pnpm push:dev` to apply changes to dev, `pnpm push:prd` for prod
3. Update the Go structs in `backend/dbEngine/models.go` to match
4. Wire up DB operations and handlers as needed

## SSL note

This package uses `sslmode=require` while the Go backend uses `sslmode=verify-full`. Why?

The Node.js `pg` driver does **not** support `sslrootcert=system`. It tries to literally open a file called `"system"`, which crashes. Go's `pgx` driver handles this natively.

`sslmode=require` still encrypts the connection — it just skips certificate verification. This is acceptable for schema tooling (push/generate/studio) but the Go backend uses `verify-full` for stronger security at runtime.
