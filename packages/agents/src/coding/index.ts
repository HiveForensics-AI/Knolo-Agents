import { Agent } from "../agent/index.js";
import { defineAgent, entry, limits, node, stateSchema, terminal, transition, type StateOf } from "../builder/index.js";
import type { EffectReceiptV1 } from "../contracts/index.js";

export interface CodingInspectionV1 {
  readonly files: readonly string[];
}

export interface CodingEditRequestV1 {
  readonly task: string;
  readonly files: readonly string[];
}

export interface CodingTestResultV1 {
  readonly passed: boolean;
  readonly summary: string;
}

export interface CodingHost {
  readonly inspect: (task: string) => CodingInspectionV1 | Promise<CodingInspectionV1>;
  readonly applyEdit: (request: CodingEditRequestV1) => EffectReceiptV1 | Promise<EffectReceiptV1>;
  readonly runTests: (task: string) => CodingTestResultV1 | Promise<CodingTestResultV1>;
}

export interface CodingWorkflowOptions {
  readonly task: string;
  readonly approval: "approved" | "denied";
  readonly host: CodingHost;
  readonly executionId?: string;
}

export interface CodingResultV1 {
  readonly version: 1;
  readonly task: string;
  readonly changed: boolean;
  readonly tests_passed: boolean;
  readonly edit_receipt_id: string;
  readonly test_summary: string;
}

export interface CodingWorkflowResult {
  readonly report: Awaited<ReturnType<ReturnType<typeof buildCodingAgent>["run"]>>;
}

const codingStateSchema = stateSchema("coding-state-v1", {
  task: "String",
  approval: "String",
  files: "Array",
  edit_receipt_id: { type: "String", optional: true },
  tests_passed: { type: "Bool", optional: true },
  test_summary: { type: "String", optional: true },
});
type CodingState = StateOf<typeof codingStateSchema>;

function buildCodingAgent(host: CodingHost) {
  const inspect = node<CodingState, "inspect">("inspect", {
    reads: ["task"],
    writes: ["files"],
    run: async ({ state }) => ({
      outcome: { type: "continue" as const, patch: { files: (await host.inspect(state.task)).files } },
    }),
  });
  const edit = node<CodingState, "edit">("edit", {
    reads: ["task", "approval", "files"],
    writes: ["edit_receipt_id"],
    run: async ({ state }) => {
      if (state.approval !== "approved") return { outcome: { type: "suspend" as const, reason: "edit-approval-required" } };
      const receipt = await host.applyEdit({ task: state.task, files: state.files as unknown as readonly string[] });
      return { outcome: { type: "continue" as const, patch: { edit_receipt_id: receipt.idempotency_key } } };
    },
  });
  const test = node<CodingState, "test">("test", {
    reads: ["task"],
    writes: ["tests_passed", "test_summary"],
    run: async ({ state }) => {
      const result = await host.runTests(state.task);
      if (!result.passed) return { outcome: { type: "fail" as const, error: result.summary, retryable: false } };
      return { outcome: { type: "continue" as const, patch: { tests_passed: true, test_summary: result.summary } } };
    },
  });
  const complete = terminal<CodingState, "complete">("complete", {
    reads: ["task", "edit_receipt_id", "tests_passed", "test_summary"],
    run: ({ state }) => ({
      outcome: {
        type: "terminate" as const,
        result: {
          version: 1,
          task: state.task,
          changed: true,
          tests_passed: state.tests_passed === true,
          edit_receipt_id: state.edit_receipt_id ?? "",
          test_summary: state.test_summary ?? "",
        } satisfies CodingResultV1,
      },
    }),
  });
  return Agent.load({
    definition: defineAgent({
      id: "local-coding-v1",
      state: codingStateSchema,
      nodes: [inspect, edit, test, complete],
      transitions: [
        transition("inspect", "continue", "edit"),
        transition("edit", "continue", "test"),
        transition("test", "continue", "complete"),
      ],
      entry: entry("inspect"),
      limits: limits({ max_steps: 4 }),
    }),
    engine: "typescript",
  });
}

/** Run an approved local coding slice through the same graph control plane as research. */
export async function runLocalCoding(options: CodingWorkflowOptions): Promise<CodingWorkflowResult> {
  if (!options.task.trim()) throw new Error("coding task is required");
  const report = await buildCodingAgent(options.host).run({ task: options.task, approval: options.approval, files: [] }, { executionId: options.executionId });
  return { report };
}
