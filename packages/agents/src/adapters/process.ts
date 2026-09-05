import { HarnessError, type AgentAdapter } from "../harness/types.js";
import { normalizeInvocation } from "./callable.js";

export interface ProcessSpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly input: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ProcessSpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export type ProcessSpawner = (request: ProcessSpawnRequest) => Promise<ProcessSpawnResult>;

export interface ProcessAgentOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly spawn?: ProcessSpawner;
  readonly id?: string;
}

/** L0 process adapter. Spawns an explicit argv vector; never uses a shell. */
export function processAgent(options: ProcessAgentOptions): AgentAdapter {
  if (!options.command) throw new HarnessError("processAgent requires an explicit command");
  if (options.args?.some(arg => arg == null)) throw new HarnessError("processAgent args must be explicit strings");
  const id = options.id ?? "process";
  const spawn = options.spawn ?? nodeSpawn;
  return {
    descriptor: () => ({ version: 1, id, name: id, level: "L0" }),
    capabilities: () => ({
      version: 1,
      level: "L0",
      tools: false,
      resume: false,
      observe: false,
      interrupt: false,
      limitations: ["process stdin/stdout only; no shell invocation"],
    }),
    async invoke(input, ctx) {
      const result = await spawn({
        command: options.command,
        args: options.args ?? [],
        cwd: options.cwd,
        env: options.env,
        input: JSON.stringify({ input, task: ctx.task }),
        timeoutMs: ctx.envelope.budget.timeoutMs,
        signal: ctx.signal,
      });
      if (result.exitCode !== 0) {
        return { status: "failed", output: { stdout: result.stdout, stderr: result.stderr }, error: `process exit ${result.exitCode}` };
      }
      let parsed: unknown = result.stdout;
      try {
        parsed = result.stdout ? JSON.parse(result.stdout) : null;
      } catch {
        parsed = result.stdout;
      }
      return normalizeInvocation(parsed);
    },
  };
}

type NodeSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Readonly<Record<string, string | undefined>>; shell: false; stdio: ["pipe", "pipe", "pipe"] },
) => {
  stdin?: { end(data: string): void };
  stdout?: { setEncoding(encoding: string): void; on(event: "data", listener: (chunk: string) => void): void };
  stderr?: { setEncoding(encoding: string): void; on(event: "data", listener: (chunk: string) => void): void };
  kill(signal: string): void;
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
};

async function nodeSpawn(request: ProcessSpawnRequest): Promise<ProcessSpawnResult> {
  const specifier = "node:child_process";
  const loaded = (await import(specifier)) as { spawn: NodeSpawn };
  return new Promise((resolve, reject) => {
    const child = loaded.spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      request.timeoutMs && request.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            reject(new HarnessError("processAgent timed out"));
          }, request.timeoutMs)
        : undefined;
    const onAbort = () => child.kill("SIGTERM");
    request.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr?.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", error => {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", code => {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      resolve({ stdout, stderr, exitCode: code });
    });
    child.stdin?.end(request.input);
  });
}
