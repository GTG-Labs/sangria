import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  bigint,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const directionEnum = pgEnum("direction", ["DEBIT", "CREDIT"]);
export const currencyEnum = pgEnum("currency", ["USD", "USDC", "ETH"]);

// ---------------------------------------------------------------------------
// 4 Account Tables (Assets + Expenses = Liabilities + Revenues)
// ---------------------------------------------------------------------------

export const assets = pgTable("assets", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  currency: currencyEnum().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const liabilities = pgTable("liabilities", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  currency: currencyEnum().notNull(),
  userId: uuid("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  currency: currencyEnum().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const revenues = pgTable("revenues", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  currency: currencyEnum().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Append-only Ledger Journal
// ---------------------------------------------------------------------------

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id").notNull(),
    currency: currencyEnum().notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    direction: directionEnum().notNull(),
    assetId: uuid("asset_id").references(() => assets.id),
    liabilityId: uuid("liability_id").references(() => liabilities.id),
    expenseId: uuid("expense_id").references(() => expenses.id),
    revenueId: uuid("revenue_id").references(() => revenues.id),
  },
  (table) => [
    index("idx_ledger_transaction_id").on(table.transactionId),
    check(
      "chk_exactly_one_fk",
      sql`(${table.assetId} IS NOT NULL)::int + (${table.liabilityId} IS NOT NULL)::int + (${table.expenseId} IS NOT NULL)::int + (${table.revenueId} IS NOT NULL)::int = 1`
    ),
  ]
);
