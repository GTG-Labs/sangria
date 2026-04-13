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
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "confirmed",
  "failed",
]);
export const directionEnum = pgEnum("direction", ["DEBIT", "CREDIT"]);
export const currencyEnum = pgEnum("currency", ["USD", "USDC", "ETH"]);
export const accountTypeEnum = pgEnum("account_type", [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
]);

// ---------------------------------------------------------------------------
// Organizations — the main business entities that own accounts and API keys
// ---------------------------------------------------------------------------
export const organizations = pgTable("organizations", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar({ length: 255 }).notNull(),
  isPersonal: boolean("is_personal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
// Organization Members — junction table for many-to-many user-organization relationships
// ---------------------------------------------------------------------------
export const organizationMembers = pgTable(
  "organization_members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.workosId),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    isAdmin: boolean("is_admin").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composite primary key - user can only be in each organization once
    primaryKey({ columns: [table.userId, table.organizationId] }),
    index("idx_organization_members_user_id").on(table.userId),
    index("idx_organization_members_organization_id").on(table.organizationId),
    index("idx_organization_members_is_admin").on(table.isAdmin),
  ],
);

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
    organizationId: uuid("organization_id").references(() => organizations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_accounts_organization_id").on(table.organizationId),
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
    status: transactionStatusEnum().notNull().default("confirmed"),
    txHash: varchar("tx_hash", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_idempotency_key").on(table.idempotencyKey),
    index("idx_transactions_created_at").on(table.createdAt.desc()),
    index("idx_transactions_status").on(table.status),
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
// Request Management Enums
// ---------------------------------------------------------------------------

export const requestStatusEnum = pgEnum("request_status", [
  "pending", // awaiting admin review
  "approved", // admin approved the request
  "rejected", // admin rejected the request
  "canceled", // requester canceled before review
]);

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending", // invitation sent, awaiting user response
  "accepted", // user accepted the invitation
  "declined", // user declined the invitation
  "expired", // invitation expired before response
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
// Merchants — API keys for businesses receiving payments through x402
// ---------------------------------------------------------------------------

export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "pending", "inactive"]);

export const merchants = pgTable(
  "merchants",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    apiKey: text("api_key").notNull(),
    keyId: varchar("key_id", { length: 8 }).notNull(),
    name: varchar({ length: 255 }).notNull(),
    status: apiKeyStatusEnum().notNull().default("active"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_merchants_organization_id").on(table.organizationId),
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

    // Admin review (set during approve/reject — immutable after that step)
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),

    // Completion/failure actor attribution
    completedBy: text("completed_by"),
    failedBy: text("failed_by"),

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

// ---------------------------------------------------------------------------
// Organization Invitations — admins inviting users to join organizations
// ---------------------------------------------------------------------------

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    inviterUserId: text("inviter_user_id")
      .notNull()
      .references(() => users.workosId), // Admin who sent the invitation
    inviteeEmail: varchar("invitee_email", { length: 255 }).notNull(), // Email being invited
    inviteeUserId: text("invitee_user_id").references(() => users.workosId), // Set when user accepts
    status: invitationStatusEnum().notNull().default("pending"),
    message: text(), // Optional welcome message from admin
    invitationToken: varchar("invitation_token", { length: 255 }).notNull(), // Secure token for email link
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 7 days from creation

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_org_invitations_organization").on(table.organizationId),
    index("idx_org_invitations_inviter").on(table.inviterUserId),
    index("idx_org_invitations_invitee_email").on(table.inviteeEmail),
    index("idx_org_invitations_invitee_user").on(table.inviteeUserId),
    index("idx_org_invitations_status").on(table.status),
    index("idx_org_invitations_expires_at").on(table.expiresAt),
    index("idx_org_invitations_created_at").on(table.createdAt.desc()),
    // Unique secure token for invitation links
    unique("uq_org_invitations_token").on(table.invitationToken),
    // Prevent duplicate pending invitations to same email for same org
    unique("uq_org_invitations_pending").on(table.organizationId, table.inviteeEmail)
      .where(sql`status = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// API Key Creation Requests — organization members requesting API key creation
// ---------------------------------------------------------------------------

export const apiKeyCreationRequests = pgTable(
  "api_key_creation_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.workosId),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    requestedKeyName: varchar("requested_key_name", { length: 255 }).notNull(),
    justification: text().notNull(), // why they need the API key
    status: requestStatusEnum().notNull().default("pending"),

    // Admin review fields
    reviewedBy: text("reviewed_by").references(() => users.workosId),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"), // admin's response/reason

    // Created merchant (when approved)
    merchantId: uuid("merchant_id").references(() => merchants.id),

    // Timestamps
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_api_key_requests_requester").on(table.requesterUserId),
    index("idx_api_key_requests_org").on(table.organizationId),
    index("idx_api_key_requests_status").on(table.status),
    index("idx_api_key_requests_created_at").on(table.createdAt.desc()),
    unique("uq_api_key_requests_merchant").on(table.merchantId), // one request per merchant
  ],
);

