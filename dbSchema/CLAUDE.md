# dbSchema CLAUDE.md

This directory owns the database schema. If something defines schema elsewhere — hand-written DDL, ad-hoc ALTER statements, Go struct tags that imply columns — that's a bug. All schema changes start here.

## Commands

```bash
pnpm push:dev           # Push schema to dev database (loads .env.dev)
pnpm push:prd           # Push schema to production (loads .env.prd, interactive — confirms destructive changes)
pnpm generate           # Generate migration SQL files (loads .env.dev)
pnpm studio             # Open Drizzle Studio browser (dev)
pnpm studio:prd         # Open Drizzle Studio browser (prod)
```

`push:prd` is interactive and will prompt before truncating tables or dropping columns. Always review the planned statements.

## Schema-First Workflow

1. Edit `schema.ts`
2. Push with `pnpm push:dev`
3. Update Go structs in `backend/dbEngine/models.go` to match (manual sync — no codegen)
4. Add DB operations in the appropriate `backend/dbEngine/*.go` file
5. Add handlers in the appropriate `backend/*Handlers/` package
6. Wire routes in the appropriate `backend/routes/*.go` file

## Gotchas

- Some account rows have a nullable org-scope column — system-level rows leave it `NULL`, org-scoped rows set it. Check the schema before assuming non-null.
- WorkOS IDs use TEXT columns, not UUID, to avoid cast issues with external identifiers.
- The migration directory (`drizzle/`) has a single initial migration. Subsequent schema changes are applied via `drizzle-kit push` rather than generated migrations.
- **Do not use `BigInt(0)` as a default on `bigint` columns.** drizzle-kit 0.31.10 can't `JSON.stringify` a BigInt during its schema-diff phase and `pnpm push:dev`/`push:prd` will crash with `TypeError: Do not know how to serialize a BigInt`. Use `` .default(sql`0`) `` instead — same on-disk behaviour (DEFAULT 0 coerced to bigint by Postgres), no serialization bug. Auto-fixers occasionally "correct" it back to `BigInt(0)` because that looks more natural — don't accept that change.
