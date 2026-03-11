import { pgTable, bigserial, bigint, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: bigserial({ mode: "number" }).primaryKey(),
  accountNumber: text("account_number").notNull().unique(),
  owner: text().notNull(),
  workosId: text("workos_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: bigserial({ mode: "number" }).primaryKey(),
  fromAccount: bigint("from_account", { mode: "number" }).notNull().references(() => accounts.id),
  toAccount: bigint("to_account", { mode: "number" }).notNull().references(() => accounts.id),
  value: numeric().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
