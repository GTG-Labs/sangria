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
  uniqueIndex,
  text,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "confirmed",
  "failed",
]);
export const paymentSchemeEnum = pgEnum("payment_scheme", ["exact", "upto"]);
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
export const organizations = pgTable(
  "organizations",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 255 }).notNull(),
    isPersonal: boolean("is_personal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("organizations_name_idx").on(table.name)],
);

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
    // Multiple LIABILITY/USD accounts per org are allowed (e.g. an org that's both
    // a merchant and an agent operator has the merchant "USD Liability" plus
    // "Agent Credits Trial — <orgID>" and "Agent Credits Paid — <orgID>"). The
    // unique constraint scopes by name so each named account is unique within an org.
    uniqueIndex("uq_accounts_org_name_liability_usd")
      .on(table.organizationId, table.name)
      .where(sql`type = 'LIABILITY' AND currency = 'USD'`),
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
    scheme: paymentSchemeEnum().notNull().default("exact"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_idempotency_key").on(table.idempotencyKey),
    index("idx_transactions_created_at").on(table.createdAt.desc()),
    index("idx_transactions_status").on(table.status),
    // Guarantee a 1-to-1 mapping between confirmed internal transactions and
    // on-chain settlements.
    uniqueIndex("uq_transactions_tx_hash_confirmed")
      .on(table.txHash)
      .where(sql`status = 'confirmed' AND tx_hash IS NOT NULL`),
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
// Invitation Management Enums
// ---------------------------------------------------------------------------

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

export const apiKeyStatusEnum = pgEnum("api_key_status", [
  "active",
  "pending",
  "inactive",
]);

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
    status: apiKeyStatusEnum().notNull().default("pending"),
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
    unique("uq_crypto_wallets_address_network").on(
      table.address,
      table.network,
    ),
    unique("uq_crypto_wallets_account_id").on(table.accountId),
  ],
);

// ---------------------------------------------------------------------------
// Withdrawals — organization payout requests
// ---------------------------------------------------------------------------

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),

    // Money
    amount: bigint({ mode: "bigint" }).notNull(),
    fee: bigint({ mode: "bigint" }).notNull().default(sql`0`),
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
    index("idx_withdrawals_organization_id").on(table.organizationId),
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
    // Prevent duplicate pending invitations to same email for same org (case-insensitive)
    uniqueIndex("uq_org_invitations_pending")
      .on(table.organizationId, sql`lower(${table.inviteeEmail})`)
      .where(sql`status = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// Agent SDK
// ---------------------------------------------------------------------------

export const agentKycStatusEnum = pgEnum("agent_kyc_status", [
  "unverified",
  "pending",
  "verified",
  "failed",
]);

export const agentTopupSourceEnum = pgEnum("agent_topup_source", [
  "trial",
  "stripe_card",
  "stripe_ach",
  "wire",
  "direct_usdc",
]);

export const agentTopupStatusEnum = pgEnum("agent_topup_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

export const agentPaymentStatusEnum = pgEnum("agent_payment_status", [
  "pending",
  "confirmed",
  "failed",
  "unresolved",
]);

// ---------------------------------------------------------------------------
// agentOperators — org-level enrollment in the agent SDK side of the network.
// Mandatory 1:1 with organizations: every org has exactly one agent_operators
// row, created atomically with the org during signup. Holds billing/identity
// metadata only — spend caps live on agent_api_keys.
// ---------------------------------------------------------------------------

export const agentOperators = pgTable(
  "agent_operators",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),

    // Per-partner trial credit override. Null means use the env-var default
    // applied at signup.
    trialCreditMicrounits: bigint("trial_credit_microunits", { mode: "bigint" }),

    // Set after first successful card top-up.
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),

    kycStatus: agentKycStatusEnum("kyc_status").notNull().default("unverified"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_agent_operators_organization_id").on(table.organizationId),
    // Partial unique on stripe_customer_id — doubles as the lookup index for
    // Stripe webhook resolution AND enforces the 1:1 operator↔Stripe-customer
    // mapping. Partial WHERE excludes NULL rows (the column stays NULL until
    // the operator's first card top-up), keeping the index small.
    uniqueIndex("uq_agent_operators_stripe_customer_id")
      .on(table.stripeCustomerId)
      .where(sql`stripe_customer_id IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// agentApiKeys — hashed API keys for agent SDK authentication. The key IS the
// agent identity: every payment is authenticated by exactly one key, so all
// per-call policy (spend caps, URL-logging granularity) lives here rather than
// on a separate "agent" entity.
// ---------------------------------------------------------------------------

export const agentApiKeys = pgTable(
  "agent_api_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    agentOperatorId: uuid("agent_operator_id")
      .notNull()
      .references(() => agentOperators.id),
    keyHash: text("key_hash").notNull(),
    keyId: varchar("key_id", { length: 8 }).notNull(),
    name: varchar({ length: 255 }).notNull(),

    // Per-key spend caps. Application code must set these on insert.
    maxPerCallMicrounits: bigint("max_per_call_microunits", {
      mode: "bigint",
    }).notNull(),
    dailyCapMicrounits: bigint("daily_cap_microunits", {
      mode: "bigint",
    }).notNull(),
    monthlyCapMicrounits: bigint("monthly_cap_microunits", {
      mode: "bigint",
    }).notNull(),
    requireConfirmAboveMicrounits: bigint(
      "require_confirm_above_microunits",
      { mode: "bigint" },
    ).notNull(),

    // Per-key policy: when false, only the host of the merchant URL is logged
    // on agent_payments rows (path + query are dropped).
    logFullUrl: boolean("log_full_url").notNull().default(true),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_agent_api_keys_key_hash").on(table.keyHash),
    index("idx_agent_api_keys_agent_operator_id").on(table.agentOperatorId),
    index("idx_agent_api_keys_key_id").on(table.keyId),
    // One active key per (operator, name); revoke before re-using a name.
    uniqueIndex("uq_agent_api_keys_active_name")
      .on(table.agentOperatorId, table.name)
      .where(sql`revoked_at IS NULL`),
    check(
      "chk_agent_api_keys_max_per_call_positive",
      sql`${table.maxPerCallMicrounits} > 0`,
    ),
    check(
      "chk_agent_api_keys_daily_cap_positive",
      sql`${table.dailyCapMicrounits} > 0`,
    ),
    check(
      "chk_agent_api_keys_monthly_cap_positive",
      sql`${table.monthlyCapMicrounits} > 0`,
    ),
    check(
      "chk_agent_api_keys_require_confirm_above_nonneg",
      sql`${table.requireConfirmAboveMicrounits} >= 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// agentPayments — full lifecycle of every agent payment attempt
// ---------------------------------------------------------------------------

export const agentPayments = pgTable(
  "agent_payments",
  {
    id: uuid().primaryKey().defaultRandom(),

    // Client-supplied UUID v4 from the SDK; SDK reuses the same value across retries
    // of the same logical call within its retry-policy window.
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),

    // Single owning key. Org/operator are reachable via api_key → agent_operator →
    // organization; we don't denormalize to keep deletion/transfer semantics clean.
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => agentApiKeys.id),

    // What the agent is paying for. merchantUrlOrHost stores the full URL when
    // the api key has logFullUrl=true; just the host otherwise.
    merchantUrlOrHost: text("merchant_url_or_host").notNull(),
    merchantPayToAddress: varchar("merchant_pay_to_address", {
      length: 64,
    }).notNull(),
    network: varchar({ length: 64 }).notNull(), // CAIP-2, e.g. "eip155:8453"; sized for max CAIP-2 (~41 chars) plus headroom — Solana CAIP-2 is 39
    scheme: paymentSchemeEnum().notNull(),

    // Amounts. settlement and fee are populated on /confirm.
    maxAmountMicrounits: bigint("max_amount_microunits", {
      mode: "bigint",
    }).notNull(),
    settlementAmountMicrounits: bigint("settlement_amount_microunits", {
      mode: "bigint",
    }),
    platformFeeMicrounits: bigint("platform_fee_microunits", {
      mode: "bigint",
    }),

    // ERC-3009 authorization expiry — needed to determine whether to mark a
    // pending intent as conclusively failed during reconciliation.
    validBefore: timestamp("valid_before", { withTimezone: true }).notNull(),

    // Signed PAYMENT-SIGNATURE bytes. Kept so retries can reuse the same
    // signature without minting a new ERC-3009 nonce.
    paymentSignatureB64: text("payment_signature_b64").notNull(),

    status: agentPaymentStatusEnum().notNull().default("pending"),
    txHash: varchar("tx_hash", { length: 255 }),

    // Set on /confirm; analogous to withdrawals.debitTransactionId.
    ledgerTransactionId: uuid("ledger_transaction_id").references(
      () => transactions.id,
    ),

    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: text("failure_message"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    unresolvedAt: timestamp("unresolved_at", { withTimezone: true }),
  },
  (table) => [
    unique("uq_agent_payments_idempotency_key").on(table.idempotencyKey),
    index("idx_agent_payments_api_key_id").on(table.apiKeyId),
    index("idx_agent_payments_status").on(table.status),
    index("idx_agent_payments_created_at").on(table.createdAt.desc()),
    // Mirrors the transactions-table partial unique on confirmed tx_hash.
    uniqueIndex("uq_agent_payments_tx_hash_confirmed")
      .on(table.txHash)
      .where(sql`status = 'confirmed' AND tx_hash IS NOT NULL`),
    check(
      "chk_agent_payments_max_amount_positive",
      sql`${table.maxAmountMicrounits} > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// agentTopups — every credit grant: trial, Stripe, ACH, wire, direct USDC
// ---------------------------------------------------------------------------

export const agentTopups = pgTable(
  "agent_topups",
  {
    id: uuid().primaryKey().defaultRandom(),
    agentOperatorId: uuid("agent_operator_id")
      .notNull()
      .references(() => agentOperators.id),

    source: agentTopupSourceEnum().notNull(),
    amountCreditsMicrounits: bigint("amount_credits_microunits", {
      mode: "bigint",
    }).notNull(),

    // Idempotency key — prevents duplicate topups from at-least-once webhook
    // delivery (Stripe, Bridge.xyz) or accidental signup retries.
    // Conventions per source:
    //   - trial:        deterministic "trial-grant-<agent_operator_id>"
    //   - stripe_*:     the Stripe payment_intent_id (e.g. "pi_3M...")
    //   - wire / direct_usdc: caller-supplied UUID
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),

    // Stripe linkage — required for stripe_card / stripe_ach sources to support
    // refunds via the Stripe API. Enforced by chk_agent_topups_stripe_pi_required
    // below; always known at insert time because Stripe Checkout in mode='payment'
    // creates the PaymentIntent immediately for both card and ACH.
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),

    // Bridge.xyz (or successor) USD→USDC conversion record.
    bridgeTransactionId: varchar("bridge_transaction_id", { length: 255 }),

    // Ledger linkage — the credit-side ledger transaction.
    ledgerTransactionId: uuid("ledger_transaction_id").references(
      () => transactions.id,
    ),

    status: agentTopupStatusEnum().notNull().default("pending"),
    failureCode: varchar("failure_code", { length: 100 }),
    failureMessage: text("failure_message"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_agent_topups_agent_operator_id").on(table.agentOperatorId),
    index("idx_agent_topups_source").on(table.source),
    index("idx_agent_topups_stripe_payment_intent_id").on(
      table.stripePaymentIntentId,
    ),
    // Per-operator dedup. Same key value across different operators is allowed
    // (extremely unlikely in practice since trial keys embed the operator ID and
    // Stripe PIIDs are global, but keeps the constraint scoped correctly).
    unique("uq_agent_topups_operator_idempotency_key").on(
      table.agentOperatorId,
      table.idempotencyKey,
    ),
    check(
      "chk_agent_topups_amount_positive",
      sql`${table.amountCreditsMicrounits} > 0`,
    ),
    // Stripe topups must always carry the PaymentIntent ID so we can refund via
    // Stripe's API later. Verified against Stripe docs: mode='payment' Checkout
    // Sessions (which Sangria uses for topups) create the PI immediately for
    // both card and us_bank_account flows, so the PI is known at every insertion
    // path. trial / wire / direct_usdc sources legitimately have no PI.
    check(
      "chk_agent_topups_stripe_pi_required",
      sql`${table.source} NOT IN ('stripe_card', 'stripe_ach') OR ${table.stripePaymentIntentId} IS NOT NULL`,
    ),
  ],
);

