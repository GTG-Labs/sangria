import { Router, Request, Response } from "express";
import { findAccountByApiKey, Account, recordUsage } from "./db.js";
import { executePython, executeNode, executeBash } from "./engine.js";

export const router = Router();

// ── Pricing (cents) ──────────────────────────────────────────────────

const PRICES = {
  python: 5,
  node: 5,
  bash: 3,
  sandbox: 10,
} as const;

// ── Auth & billing helpers ───────────────────────────────────────────

function authenticate(req: Request): Account | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return findAccountByApiKey(header.slice(7));
}

function hasBalance(account: Account | undefined, costCents: number): boolean {
  if (!account) return false;
  return account.balanceCents >= costCents;
}

function charge(account: Account, endpoint: string, costCents: number) {
  account.balanceCents -= costCents;
  recordUsage(account.id, endpoint, costCents);
}

// ── Free endpoints ───────────────────────────────────────────────────

router.get("/", (_req, res) => {
  res.json({
    service: "E2B Code Execution API",
    version: "1.0.0",
    description: "Secure, scalable code execution environments for AI agents",
    endpoints: {
      "GET  /": "Service info (free)",
      "POST /execute/python": `Run Python code — $${(PRICES.python / 100).toFixed(2)}/call`,
      "POST /execute/node": `Run Node.js code — $${(PRICES.node / 100).toFixed(2)}/call`,
      "POST /execute/bash": `Run bash commands — $${(PRICES.bash / 100).toFixed(2)}/call`,
      "POST /sandbox/create": `Create sandbox session — $${(PRICES.sandbox / 100).toFixed(2)}/call`,
      "GET  /sandbox/:id/files": "List files in sandbox (free)",
    },
    authentication: "Bearer token via Authorization header",
  });
});

router.get("/sandbox/:sandboxId/files", (_req, res) => {
  res.json({
    files: [
      { name: "main.py", type: "file", size: 1024, modified: "2026-05-05T10:30:00Z" },
      { name: "data", type: "directory", modified: "2026-05-05T09:15:00Z" },
      { name: "output.txt", type: "file", size: 256, modified: "2026-05-05T11:00:00Z" },
    ],
  });
});

// ── Paid endpoints ───────────────────────────────────────────────────

router.post("/execute/python", (req: Request, res: Response) => {
  const account = authenticate(req);
  if (!hasBalance(account, PRICES.python)) {
    res.status(402).json({ error: "Insufficient balance" });
    return;
  }

  const { code, timeout } = req.body;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required and must be a string" });
    return;
  }

  const result = executePython(code, timeout ? timeout * 1000 : undefined);
  charge(account!, req.path, PRICES.python);

  res.json({ ...result, cost: { cents: PRICES.python, balanceRemaining: account!.balanceCents } });
});

router.post("/execute/node", (req: Request, res: Response) => {
  const account = authenticate(req);
  if (!hasBalance(account, PRICES.node)) {
    res.status(402).json({ error: "Insufficient balance" });
    return;
  }

  const { code, timeout } = req.body;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "code is required and must be a string" });
    return;
  }

  const result = executeNode(code, timeout ? timeout * 1000 : undefined);
  charge(account!, req.path, PRICES.node);

  res.json({ ...result, cost: { cents: PRICES.node, balanceRemaining: account!.balanceCents } });
});

router.post("/execute/bash", (req: Request, res: Response) => {
  const account = authenticate(req);
  if (!hasBalance(account, PRICES.bash)) {
    res.status(402).json({ error: "Insufficient balance" });
    return;
  }

  const { command, timeout } = req.body;
  if (!command || typeof command !== "string") {
    res.status(400).json({ error: "command is required and must be a string" });
    return;
  }

  const result = executeBash(command, timeout ? timeout * 1000 : undefined);
  charge(account!, req.path, PRICES.bash);

  res.json({ ...result, cost: { cents: PRICES.bash, balanceRemaining: account!.balanceCents } });
});

router.post("/sandbox/create", (req: Request, res: Response) => {
  const account = authenticate(req);
  if (!hasBalance(account, PRICES.sandbox)) {
    res.status(402).json({ error: "Insufficient balance" });
    return;
  }

  const { template = "base", ttlMinutes = 30 } = req.body;
  charge(account!, req.path, PRICES.sandbox);

  const sandboxId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  res.json({
    sandboxId,
    template,
    status: "running",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
    connectionUrl: `wss://sandbox.e2b.dev/${sandboxId}`,
    capabilities: ["python", "node", "bash", "filesystem"],
    resourceLimits: { cpuCores: 1, memoryMb: 512, diskMb: 1024, networkEnabled: true },
    cost: { cents: PRICES.sandbox, balanceRemaining: account!.balanceCents },
  });
});
