import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface ExecutionResult {
  executionId: string;
  language: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  sandboxId: string;
  timestamp: string;
}

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 64 * 1024; // 64 KB

function run(command: string, timeoutMs = TIMEOUT_MS): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: typeof err.status === "number" ? err.status : 1,
    };
  }
}

export function executePython(code: string, timeoutMs?: number): ExecutionResult {
  const start = performance.now();
  const result = run(`python3 -c ${shellEscape(code)}`, timeoutMs);
  return wrap("python", result, performance.now() - start);
}

export function executeNode(code: string, timeoutMs?: number): ExecutionResult {
  const start = performance.now();
  const result = run(`node -e ${shellEscape(code)}`, timeoutMs);
  return wrap("node", result, performance.now() - start);
}

export function executeBash(command: string, timeoutMs?: number): ExecutionResult {
  const start = performance.now();
  const result = run(`bash -c ${shellEscape(command)}`, timeoutMs);
  return wrap("bash", result, performance.now() - start);
}

function wrap(
  language: string,
  result: { stdout: string; stderr: string; exitCode: number },
  elapsedMs: number,
): ExecutionResult {
  return {
    executionId: `exec_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    language,
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    executionTimeMs: Math.round(elapsedMs),
    sandboxId: `sb_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    timestamp: new Date().toISOString(),
  };
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
