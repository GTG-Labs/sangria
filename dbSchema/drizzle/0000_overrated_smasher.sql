CREATE TYPE "public"."account_type" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'USDC', 'ETH');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."network" AS ENUM('base', 'base-sepolia', 'polygon', 'solana', 'solana-devnet');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'settled', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" "currency" NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"api_key" text NOT NULL,
	"key_id" varchar(8) NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_cards_api_key" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "crypto_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" varchar(255) NOT NULL,
	"network" "network" NOT NULL,
	"account_id" uuid NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_wallets_address_unique" UNIQUE("address"),
	CONSTRAINT "uq_crypto_wallets_account_id" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"amount" bigint NOT NULL,
	"direction" "direction" NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"api_key" text NOT NULL,
	"key_id" varchar(8) NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_merchants_api_key" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"crypto_wallet_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"network" "network" NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"settlement_tx_hash" text,
	"payer_address" text,
	"idempotency_key" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "uq_payments_settlement_tx_hash" UNIQUE("settlement_tx_hash")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_idempotency_key" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"workos_id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_workos_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("workos_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallets" ADD CONSTRAINT "crypto_wallets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_workos_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("workos_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_crypto_wallet_id_crypto_wallets_id_fk" FOREIGN KEY ("crypto_wallet_id") REFERENCES "public"."crypto_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_user_id" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_accounts_type" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_cards_user_id" ON "cards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_cards_key_id" ON "cards" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "idx_crypto_wallets_last_used_at" ON "crypto_wallets" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX "idx_crypto_wallets_network" ON "crypto_wallets" USING btree ("network");--> statement-breakpoint
CREATE INDEX "idx_ledger_transaction_id" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_account_id" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "idx_merchants_user_id" ON "merchants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_merchants_key_id" ON "merchants" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "idx_payments_merchant_id" ON "payments" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "idx_payments_status" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_payments_idempotency_key" ON "payments" USING btree ("idempotency_key");