CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"account_number" text NOT NULL,
	"owner" text NOT NULL,
	"workos_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_number_unique" UNIQUE("account_number"),
	CONSTRAINT "accounts_workos_id_unique" UNIQUE("workos_id")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"from_account" bigint NOT NULL,
	"to_account" bigint NOT NULL,
	"value" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_account_accounts_id_fk" FOREIGN KEY ("from_account") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_accounts_id_fk" FOREIGN KEY ("to_account") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;