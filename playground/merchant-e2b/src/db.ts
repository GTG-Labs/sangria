export interface Account {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  balanceCents: number;
  createdAt: Date;
}

export interface UsageRecord {
  id: string;
  accountId: string;
  endpoint: string;
  costCents: number;
  timestamp: Date;
}

const accounts = new Map<string, Account>();
const apiKeyIndex = new Map<string, string>(); // apiKey → accountId
const usageRecords: UsageRecord[] = [];

// ── Seed data ────────────────────────────────────────────────────────

const seed: Account[] = [
  {
    id: "acct_01J5KQWX8M3NRPV2",
    name: "Acme Corp",
    email: "dev@acme.com",
    apiKey: "e2b_sk_live_7fR3kWpLm9xQ2vN8",
    balanceCents: 5000, // $50.00
    createdAt: new Date("2026-01-15T09:00:00Z"),
  },
  {
    id: "acct_01J5KR4TZG7BHJY6",
    name: "Indie Dev",
    email: "solo@example.com",
    apiKey: "e2b_sk_live_2nXp8VqKs4wR6dM1",
    balanceCents: 12, // $0.12 — nearly empty
    createdAt: new Date("2026-03-22T14:30:00Z"),
  },
  {
    id: "acct_01J5KR9CMW2DFPQ5",
    name: "AI Startup Inc",
    email: "platform@aistartup.io",
    apiKey: "e2b_sk_live_9tYm3LnBw5jK7hF4",
    balanceCents: 25000, // $250.00
    createdAt: new Date("2026-04-01T11:15:00Z"),
  },
];

for (const acct of seed) {
  accounts.set(acct.id, acct);
  apiKeyIndex.set(acct.apiKey, acct.id);
}

// ── Queries ──────────────────────────────────────────────────────────

export function findAccountByApiKey(apiKey: string): Account | undefined {
  const id = apiKeyIndex.get(apiKey);
  if (!id) return undefined;
  return accounts.get(id);
}

export function getAccount(id: string): Account | undefined {
  return accounts.get(id);
}

export function recordUsage(accountId: string, endpoint: string, costCents: number): UsageRecord {
  const record: UsageRecord = {
    id: `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    accountId,
    endpoint,
    costCents,
    timestamp: new Date(),
  };
  usageRecords.push(record);
  return record;
}

export function getUsageByAccount(accountId: string): UsageRecord[] {
  return usageRecords.filter((r) => r.accountId === accountId);
}
