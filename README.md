# sangria-net

A payment network for agents and merchants to pay each other! Super simple and powered by the x402 protocol!

## Repo layout

| Directory | What it is | Stack |
|---|---|---|
| `backend/` | HTTP API server — accounts & transactions CRUD | Go, Fiber, pgx |
| `dbSchema/` | Database schema (single source of truth) | TypeScript, Drizzle ORM |
| `frontend/` | Documentation & landing page | Next.js, Tailwind |
| `playground/` | x402 micropayment protocol demo | Python, FastAPI |

## Prerequisites

- [Go 1.25+](https://go.dev/dl/)
- [Node.js 18+](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- A running [PostgreSQL](https://www.postgresql.org/) instance (local or hosted)

> **Schema-first workflow:** The database schema lives in `dbSchema/` as TypeScript (Drizzle ORM) and is the single source of truth. You define tables there, run `pnpm push` to apply them to Postgres, then write matching Go structs and queries in `backend/dbEngine/`. The Go backend never runs migrations — it expects the tables to already exist.

## Quick start

```bash
git clone https://github.com/GTG-Labs/sangria-net.git
cd sangria-net
```

### 1. Set up the database schema service (only needed if you want to update the schema)

```bash
cd dbSchema
pnpm install
cp .env.example .env        # fill in your DATABASE_URL
pnpm push                   # apply schema to Postgres
cd ..
```

### 2. Run the backend

```bash
cd backend
cp .env.example .env        # fill in your DATABASE_URL
go build && go run .
```

The API is now running at `http://localhost:3000`.

### 3. Test it

```bash
# Health check
curl http://localhost:3000/

# Create an account
curl -X POST "http://localhost:3000/accounts?account_number=ACC001&owner=Alice"

# List accounts
curl http://localhost:3000/accounts
```

## Sub-project docs

- [`backend/README.md`](backend/README.md) — API reference, project structure, how to add endpoints
- [`dbSchema/README.md`](dbSchema/README.md) — Schema-first workflow, Drizzle commands
- [`frontend/README.md`](frontend/README.md) — Next.js docs site setup
- [`playground/README.md`](playground/README.md) — x402 micropayment demo
