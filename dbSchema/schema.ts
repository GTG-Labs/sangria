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
// this is the pure WorkOS ID users
export const users = pgTable("users", {
  workosId: text("workos_id").primaryKey(),
  owner: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Admins — access control list for Sangria staff
// ---------------------------------------------------------------------------
export const admins = pgTable("admins", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.workosId),
  createdAt: timestamp("created_at", { withTimezone: true })
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

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending_approval", // amount > auto-approve threshold, awaiting admin review
  "approved", // auto-approved or admin approved, ready for bank transfer
  "processing", // bank transfer initiated
  "completed", // funds arrived at merchant's bank
  "failed", // bank rejected the transfer
  "reversed", // funds returned after initial success (bounce-back)
  "canceled", // admin rejected or merchant canceled before processing
]);

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

// ---------------------------------------------------------------------------
// Withdrawals — merchant payout requests
// ---------------------------------------------------------------------------

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid().primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),

    // Money
    amount: bigint({ mode: "bigint" }).notNull(),
    fee: bigint({ mode: "bigint" }).notNull().default(0),
    netAmount: bigint("net_amount", { mode: "bigint" }).notNull(),

    // Status lifecycle
    status: withdrawalStatusEnum().notNull().default("pending_approval"),

    // Ledger transaction references
    debitTransactionId: uuid("debit_transaction_id").references(
      () => transactions.id,
    ),
    completionTransactionId: uuid("completion_transaction_id").references(
      () => transactions.id,
    ),
    reversalTransactionId: uuid("reversal_transaction_id").references(
      () => transactions.id,
    ),

    // Failure info
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: text("failure_message"),

    // Admin review
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),

    // Idempotency
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),

    // Per-status timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_withdrawals_merchant_id").on(table.merchantId),
    index("idx_withdrawals_status").on(table.status),
    unique("uq_withdrawals_idempotency_key").on(table.idempotencyKey),
    check("chk_withdrawals_amount_positive", sql`${table.amount} > 0`),
  ],
);

