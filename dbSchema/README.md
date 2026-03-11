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
cp .env.example .env   # fill in your DATABASE_URL
```

### Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string. Uses `sslmode=require` (see [SSL note](#ssl-note) below). |

## Commands

| Command | What it does |
|---|---|
| `pnpm push` | Apply the current schema to the database (creates/alters tables) |
| `pnpm generate` | Generate migration SQL files (saved to `./drizzle/`) |
| `pnpm studio` | Open Drizzle Studio — a visual browser for your database |

`pnpm push` is the main command you'll use during development. It compares `schema.ts` against the live database and applies any differences.

## Current schema

Defined in `schema.ts`:

**accounts**
| Column | Type | Notes |
|---|---|---|
| id | bigserial | Primary key |
| account_number | text | Unique, not null |
| owner | text | Not null |
| created_at | timestamp (tz) | Defaults to now |
| updated_at | timestamp (tz) | Defaults to now |

**transactions**
| Column | Type | Notes |
|---|---|---|
| id | bigserial | Primary key |
| from_account | bigint | FK → accounts.id |
| to_account | bigint | FK → accounts.id |
| value | numeric | Not null |
| created_at | timestamp (tz) | Defaults to now |

## Updating the schema

1. Edit `schema.ts` — add/modify tables using [Drizzle's column types](https://orm.drizzle.team/docs/column-types/pg)
2. Run `pnpm push` to apply changes to the database
3. Update the Go structs in `backend/dbEngine/models.go` to match
4. Update queries in `backend/dbEngine/queries.go` if needed

## SSL note

This package uses `sslmode=require` while the Go backend uses `sslmode=verify-full`. Why?

The Node.js `pg` driver does **not** support `sslrootcert=system`. It tries to literally open a file called `"system"`, which crashes. Go's `pgx` driver handles this natively.

`sslmode=require` still encrypts the connection — it just skips certificate verification. This is acceptable for schema tooling (push/generate/studio) but the Go backend uses `verify-full` for stronger security at runtime.
