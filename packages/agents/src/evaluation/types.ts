import type { JsonValue } from "../contracts/index.js";
import type { SemanticJudgeRecordV1 } from "../harness/types.js";
import type { AcsRecordedRun, AcsSuiteV1 } from "./acs.js";

export type EvaluationPhaseV1 = "contract" | "artifact" | "task" | "judge";

export type SemanticJudgeFn = (input: {
  readonly task: AcsSuiteV1["task"] | { readonly objective: string; readonly successCriteria: readonly string[] };
  readonly output: unknown;
  readonly envelope?: unknown;
}) => SemanticJudgeRecordV1 | Promise<SemanticJudgeRecordV1>;

export interface EvaluationSuiteV1 {
  readonly version: 1;
  readonly id: string;
  readonly expectedTools?: readonly string[];
  readonly requiredEvidence?: readonly string[];
  readonly targetTokens?: number;
  readonly injectedFailure?: string;
  readonly baseline?: AcsRecordedRun;
  readonly judgeRequired?: boolean;
}

export interface AcsComparisonV1 {
  readonly suiteId: string;
  readonly baseline: number;
  readonly harnessed: number;
  readonly uplift: number;
  readonly relativeUplift: number;
  readonly meetsTarget: boolean;
}

export interface AcsHarnessReportV1 {
  readonly version: 1;
  readonly kind: "acs-harness-report";
  readonly target: 10;
  readonly baselineMean: number;
  readonly harnessMean: number;
  readonly relativeUplift: number;
  readonly meetsTarget: boolean;
  readonly suites: readonly AcsComparisonV1[];
}

export type { JsonValue };
