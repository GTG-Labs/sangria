import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  bigint,
  boolean,
  check,
  index,
  unique,
  text,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const directionEnum = pgEnum("direction", ["DEBIT", "CREDIT"]);
export const currencyEnum = pgEnum("currency", ["USD", "USDC", "ETH"]);
export const accountTypeEnum = pgEnum("account_type", [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
]);
export const userRoleEnum = pgEnum("user_role", ["member", "admin"]);

// this is the pure WorkOS ID users
export const users = pgTable("users", {
  workosId: text("workos_id").primaryKey(),
  owner: text().notNull(),
  role: userRoleEnum().notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Unified Accounts Table
// ---------------------------------------------------------------------------
// this is for pure accounting purposes like our base financial engine
export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 255 }).notNull(),
    type: accountTypeEnum().notNull(),
    currency: currencyEnum().notNull(),
    userId: text("user_id").references(() => users.workosId),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_accounts_user_id").on(table.userId),
    index("idx_accounts_type").on(table.type),
  ],
);

// ---------------------------------------------------------------------------
// Transactions (idempotency envelope for ledger writes)
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  "transactions",
  {
    id: uuid().primaryKey().defaultRandom(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_idempotency_key").on(table.idempotencyKey),
    index("idx_transactions_created_at").on(table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Append-only Ledger Journal
// ---------------------------------------------------------------------------

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    currency: currencyEnum().notNull(),
    amount: bigint({ mode: "bigint" }).notNull(),
    direction: directionEnum().notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
  },
  (table) => [
    index("idx_ledger_transaction_id").on(table.transactionId),
    index("idx_ledger_account_id").on(table.accountId),
    check("chk_ledger_entries_amount_positive", sql`${table.amount} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// x402 Enums
// ---------------------------------------------------------------------------

export const networkEnum = pgEnum("network", [
  "base", // eip155:8453
  "base-sepolia", // eip155:84532
  "polygon", // eip155:137
  "solana", // solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
  "solana-devnet", // solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
]);

// ---------------------------------------------------------------------------
// Cards — API keys for companies/developers integrating the Sangria user SDK
// ---------------------------------------------------------------------------

export const cards = pgTable(
  "cards",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.workosId),
    apiKey: text("api_key").notNull(),
    keyId: varchar("key_id", { length: 8 }).notNull(),
    name: varchar({ length: 255 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_cards_user_id").on(table.userId),
    index("idx_cards_key_id").on(table.keyId),
    unique("uq_cards_api_key").on(table.apiKey),
  ],
);

// ---------------------------------------------------------------------------
// Merchants — API keys for businesses receiving payments through x402
// ---------------------------------------------------------------------------

export const merchants = pgTable(
  "merchants",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.workosId),
    apiKey: text("api_key").notNull(),
    keyId: varchar("key_id", { length: 8 }).notNull(),
    name: varchar({ length: 255 }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_merchants_user_id").on(table.userId),
    index("idx_merchants_key_id").on(table.keyId),
    unique("uq_merchants_api_key").on(table.apiKey),
  ],
);

// ---------------------------------------------------------------------------
// Crypto Wallets — Sangria-owned CDP wallets (one per network)
// ---------------------------------------------------------------------------

export const cryptoWallets = pgTable(
  "crypto_wallets",
  {
    id: uuid().primaryKey().defaultRandom(),
    address: varchar({ length: 255 }).notNull(),
    network: networkEnum().notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .notNull()
      .default(new Date(0)),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_crypto_wallets_last_used_at").on(table.lastUsedAt),
    index("idx_crypto_wallets_network").on(table.network),
    unique("uq_crypto_wallets_address_network").on(table.address, table.network),
    unique("uq_crypto_wallets_account_id").on(table.accountId),
  ],
);

