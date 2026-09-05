import { IcpAgentRuntimeClient, type AgentRuntimeActor, type RunReportDto } from "../icp/index.js";
import { HarnessError, type AgentAdapter, type AgentCapabilitiesV1, type AgentInvocationResultV1, type HarnessCheckpointV1 } from "../harness/types.js";

export interface IcpAgentOptions {
  readonly client?: IcpAgentRuntimeClient;
  readonly actor?: AgentRuntimeActor;
  readonly id?: string;
  readonly executionId?: string;
}

/**
 * Platform adapter over `IcpAgentRuntimeClient`.
 * Harness core must not import this module; pass the returned AgentAdapter in.
 */
export function icpAgent(options: IcpAgentOptions): AgentAdapter {
  const client = options.client ?? (options.actor ? new IcpAgentRuntimeClient(options.actor) : undefined);
  if (!client) throw new HarnessError("icpAgent requires a host-supplied IcpAgentRuntimeClient or actor");
  const id = options.id ?? "icp";
  let cached: AgentCapabilitiesV1 | undefined;
  return {
    descriptor: () => ({ version: 1, id, name: id, level: "platform" }),
    capabilities: () => {
      if (cached) return cached;
      cached = {
        version: 1,
        level: "platform",
        tools: false,
        resume: true,
        observe: true,
        interrupt: false,
        limitations: ["ICP canister host; capabilities are those the Candid surface actually exposes"],
      };
      return cached;
    },
    async invoke(input, ctx) {
      const inspection = await client.inspect();
      cached = {
        version: 1,
        level: "platform",
        tools: (inspection.capabilities ?? []).includes("tools"),
        resume: true,
        observe: true,
        interrupt: false,
        limitations: inspection.limitations?.length ? inspection.limitations : ["ICP canister host"],
      };
      const executionId = options.executionId ?? ctx.runId;
      const report = await client.startExecution(executionId, input ?? ctx.task.inputs ?? {});
      return fromIcpReport(report);
    },
    async resume(checkpoint: HarnessCheckpointV1) {
      const executionId =
        typeof checkpoint.payload === "object" && checkpoint.payload && "executionId" in checkpoint.payload
          ? String((checkpoint.payload as { executionId: string }).executionId)
          : checkpoint.runId;
      return fromIcpReport(await client.resume(executionId));
    },
    observe(sink) {
      return {
        dispose() {
          void sink;
        },
      };
    },
  };
}

function fromIcpReport(report: RunReportDto): AgentInvocationResultV1 {
  if (!report.ok) return { status: "failed", output: report, error: report.message || "icp execution failed" };
  const kind = report.status?.kind ?? "";
  let parsed: unknown = report.state_json;
  try {
    parsed = report.state_json ? JSON.parse(report.state_json) : null;
  } catch {
    parsed = report.state_json;
  }
  if (kind === "terminated") return { status: "succeeded", output: parsed, tokens: Number(report.tokens ?? 0) };
  if (kind === "suspended") return { status: "suspended", output: parsed, error: report.status.detail, tokens: Number(report.tokens ?? 0) };
  if (kind === "failed" || kind === "cancelled") return { status: "failed", output: parsed, error: report.status.detail || kind, tokens: Number(report.tokens ?? 0) };
  return { status: "partial", output: parsed, tokens: Number(report.tokens ?? 0) };
}
