/** Inert spawn envelopes. Issuing a spawn does not call a model or start a worker. */

import { uniqueSorted } from "../capabilities/authority.js";
import type { JsonValue } from "../contracts/index.js";
import type { AuthorityV1, HandoffEnvelopeV1 } from "../multi-agent/index.js";
import { digestRoot } from "./hash.js";
import { evaluateInvocation, jsonValue } from "./lifecycle.js";
import { createHarness } from "./session.js";
import type { CreateHarnessOptions } from "./session.js";
import { validateTask } from "./task.js";
import type {
  AgentAdapter,
  AgentDescriptorV1,
  ContextEnvelopeV1,
  EvaluationReceiptV1,
  HarnessBudgetV1,
  InvocationStatusV1,
  TaskV1,
} from "./types.js";
import { HarnessError } from "./types.js";

const LEVELS = new Set(["L0", "L1", "L2", "L3", "platform"]);

export interface SpawnAuthorityV1 {
  readonly capabilities: readonly string[];
  readonly tools: readonly string[];
  readonly namespaces: readonly string[];
  readonly maxSteps: number;
  readonly maxCostMicros: number;
}

export interface SpawnEnvelopeV1 {
  readonly version: 1;
  readonly parent: AgentDescriptorV1;
  readonly task: TaskV1;
  readonly taskRoot: string;
  readonly authority: SpawnAuthorityV1;
  readonly contextRoot: string;
  readonly dependencyRoot: string;
  readonly skillSelectionReceipt: string | null;
  readonly evidenceReceipts: readonly string[];
  readonly knowledgeStateRoots: readonly string[];
  readonly returnContract: string;
  readonly expiryMs?: number;
  readonly envelopeRoot: string;
}

export interface SpawnReceiptV1 {
  readonly version: 1;
  readonly envelopeRoot: string;
  readonly outputRoot: string;
  readonly evaluation: EvaluationReceiptV1;
  readonly skillSelectionReceipt: string | null;
  readonly evidenceReceipts: readonly string[];
  readonly knowledgeStateRoots: readonly string[];
  readonly finalStatus: InvocationStatusV1;
  readonly output: JsonValue;
}

export interface IssuedSpawn {
  readonly envelope: SpawnEnvelopeV1;
  readonly context: ContextEnvelopeV1;
}

export interface IssueSpawnOptions {
  readonly parent: AgentDescriptorV1 | AgentAdapter;
  readonly task: TaskV1;
  readonly authority: SpawnAuthorityV1;
  readonly pack: SpawnAuthorityV1;
  readonly projection?: SpawnAuthorityV1;
  readonly evidence?: CreateHarnessOptions["evidence"];
  readonly memories?: CreateHarnessOptions["memories"];
  readonly memory?: CreateHarnessOptions["memory"];
  readonly skills?: CreateHarnessOptions["skills"];
  readonly knowledge?: readonly string[];
  readonly contextBudget?: CreateHarnessOptions["contextBudget"];
  readonly semanticRerank?: CreateHarnessOptions["semanticRerank"];
  readonly semanticRerankModel?: string;
  readonly registry?: CreateHarnessOptions["registry"];
  readonly lockfile?: CreateHarnessOptions["lockfile"];
  readonly offline?: boolean;
  readonly forceRegistry?: boolean;
  readonly limits?: HarnessBudgetV1;
  readonly middleware?: CreateHarnessOptions["middleware"];
  readonly returnContract?: string;
  readonly expiryMs?: number;
  readonly clock?: () => number;
  readonly runId?: string;
}

export interface CloseSpawnOptions {
  readonly status?: InvocationStatusV1;
  readonly toolCalls?: readonly string[];
  readonly clock?: () => number;
}

export function assertSpawnAuthority(child: SpawnAuthorityV1, parent: SpawnAuthorityV1, pack: SpawnAuthorityV1): void {
  const narrowed = normalizeAuthority(child, "spawn authority");
  const parentAuthority = normalizeAuthority(parent, "parent authority");
  const packAuthority = normalizeAuthority(pack, "pack authority");
  const subset = (left: readonly string[], right: readonly string[]): boolean => left.every(item => right.includes(item));
  if (
    !subset(narrowed.capabilities, parentAuthority.capabilities)
    || !subset(narrowed.capabilities, packAuthority.capabilities)
    || !subset(narrowed.tools, parentAuthority.tools)
    || !subset(narrowed.tools, packAuthority.tools)
    || !subset(narrowed.namespaces, parentAuthority.namespaces)
    || !subset(narrowed.namespaces, packAuthority.namespaces)
    || narrowed.maxSteps > Math.min(parentAuthority.maxSteps, packAuthority.maxSteps)
    || narrowed.maxCostMicros > Math.min(parentAuthority.maxCostMicros, packAuthority.maxCostMicros)
  ) {
    throw new HarnessError("spawn authority escalation");
  }
}

export async function issueSpawn(options: IssueSpawnOptions): Promise<IssuedSpawn> {
  if (!options?.parent) throw new HarnessError("issueSpawn requires a parent");
  const task = validateTask(options.task);
  const parentAuthority = normalizeAuthority(options.authority, "parent authority");
  const packAuthority = normalizeAuthority(options.pack, "pack authority");
  const ceiling = intersectSpawn(parentAuthority, packAuthority);
  const budget = { ...(task.budget ?? {}), ...(options.limits ?? {}) };
  assertBudgetWithin(budget, ceiling);
  let child = applyBudget(ceiling, budget);
  if (options.projection) {
    const projection = normalizeAuthority(options.projection, "spawn authority");
    assertSpawnAuthority(projection, parentAuthority, packAuthority);
    assertBudgetWithin(budget, projection);
    child = applyBudget(projection, budget);
  }
  const returnContract = options.returnContract ?? "spawn.return.v1";
  if (!returnContract.trim()) throw new HarnessError("spawn returnContract must be a non-empty string");
  const expiryMs = options.expiryMs;
  if (expiryMs !== undefined && (!Number.isSafeInteger(expiryMs) || expiryMs <= 0)) {
    throw new HarnessError("spawn expiryMs must be a positive integer");
  }
  const parent = parentAdapter(options.parent);
  const session = await createHarness({
    agent: parent,
    task,
    authority: { capabilities: [...child.capabilities], tools: [...child.tools], namespaces: [...child.namespaces] },
    evidence: options.evidence,
    memories: options.memories,
    memory: options.memory,
    skills: options.skills,
    knowledge: options.knowledge,
    contextBudget: options.contextBudget,
    semanticRerank: options.semanticRerank,
    semanticRerankModel: options.semanticRerankModel,
    registry: options.registry,
    lockfile: options.lockfile,
    offline: options.offline,
    forceRegistry: options.forceRegistry,
    limits: options.limits,
    middleware: options.middleware,
    clock: options.clock,
    runId: options.runId,
  });
  const prepared = await session.prepare();
  const descriptor = descriptorOf(parent.descriptor());
  const body = {
    version: 1 as const,
    parent: descriptor,
    task,
    taskRoot: await digestRoot("task", task),
    authority: child,
    contextRoot: await digestRoot("context", prepared.envelope),
    dependencyRoot: prepared.dependencyRoot,
    skillSelectionReceipt: prepared.skills ? await digestRoot("skill-selection", prepared.skills) : null,
    evidenceReceipts: [prepared.selectionRoot],
    knowledgeStateRoots: [...prepared.knowledgeStateRoots],
    returnContract,
    ...(expiryMs !== undefined ? { expiryMs } : {}),
  };
  const envelope: SpawnEnvelopeV1 = { ...body, envelopeRoot: await digestRoot("spawn", body) };
  return { envelope, context: prepared.envelope };
}

export async function verifySpawnEnvelope(envelope: SpawnEnvelopeV1, clock?: () => number): Promise<SpawnEnvelopeV1> {
  const parsed = parseSpawnEnvelope(envelope);
  const root = await digestRoot("spawn", envelopeBody(parsed));
  if (root !== parsed.envelopeRoot) throw new HarnessError("spawn envelope root mismatch");
  if (parsed.expiryMs !== undefined && clock && clock() > parsed.expiryMs) throw new HarnessError("spawn envelope expired");
  return parsed;
}

/** Project a verified spawn onto a handoff envelope. Does not start a worker. */
export async function handoffFromSpawn(
  envelope: SpawnEnvelopeV1,
  options: { readonly destination: string; readonly stateProjection?: Readonly<Record<string, string>> },
): Promise<HandoffEnvelopeV1> {
  const parsed = await verifySpawnEnvelope(envelope);
  const destination = options?.destination?.trim();
  if (!destination) throw new HarnessError("handoff destination is required");
  const authorityProjection: AuthorityV1 = {
    capabilities: [...parsed.authority.capabilities],
    namespaces: [...parsed.authority.namespaces],
    maxSteps: parsed.authority.maxSteps,
    maxCostMicros: parsed.authority.maxCostMicros,
  };
  return {
    version: 1,
    destination,
    stateProjection: { ...(options.stateProjection ?? {}) },
    authorityProjection,
    returnContract: parsed.returnContract,
  };
}

export async function closeSpawn(envelope: SpawnEnvelopeV1, output: unknown, options: CloseSpawnOptions = {}): Promise<SpawnReceiptV1> {
  const parsed = await verifySpawnEnvelope(envelope, options.clock);
  const toolCalls = options.toolCalls ?? [];
  const prohibited = parsed.task.prohibitedActions ?? [];
  const refused = toolCalls.filter(call => prohibited.includes(call));
  if (refused.length > 0) throw new HarnessError(`spawn close refused prohibited tool: ${refused.join(",")}`);
  const status = options.status ?? "succeeded";
  const evaluation = evaluateInvocation(parsed.task, status, output, toolCalls);
  return {
    version: 1,
    envelopeRoot: parsed.envelopeRoot,
    outputRoot: await digestRoot("output", output ?? null),
    evaluation,
    skillSelectionReceipt: parsed.skillSelectionReceipt,
    evidenceReceipts: [...parsed.evidenceReceipts],
    knowledgeStateRoots: [...parsed.knowledgeStateRoots],
    finalStatus: evaluation.prohibitedViolations.length ? "failed" : status,
    output: jsonValue(output),
  };
}

export function parseSpawnEnvelope(value: SpawnEnvelopeV1): SpawnEnvelopeV1 {
  if (!value || typeof value !== "object") throw new HarnessError("spawn envelope is required");
  if (value.version !== 1) throw new HarnessError("spawn envelope version must be 1");
  const task = validateTask(value.task);
  const authority = normalizeAuthority(value.authority, "spawn authority");
  const parent = descriptorOf(value.parent);
  if (typeof value.taskRoot !== "string" || !value.taskRoot.startsWith("task:")) throw new HarnessError("spawn taskRoot is required");
  if (typeof value.contextRoot !== "string" || !value.contextRoot.startsWith("context:")) throw new HarnessError("spawn contextRoot is required");
  if (typeof value.dependencyRoot !== "string" || !value.dependencyRoot) throw new HarnessError("spawn dependencyRoot is required");
  if (value.skillSelectionReceipt !== null && typeof value.skillSelectionReceipt !== "string") {
    throw new HarnessError("spawn skillSelectionReceipt must be a string or null");
  }
  if (!Array.isArray(value.evidenceReceipts) || value.evidenceReceipts.some(item => typeof item !== "string")) {
    throw new HarnessError("spawn evidenceReceipts must be an array of strings");
  }
  if (!Array.isArray(value.knowledgeStateRoots) || value.knowledgeStateRoots.some(item => typeof item !== "string")) {
    throw new HarnessError("spawn knowledgeStateRoots must be an array of strings");
  }
  if (typeof value.returnContract !== "string" || !value.returnContract.trim()) throw new HarnessError("spawn returnContract must be a non-empty string");
  if (value.expiryMs !== undefined && (!Number.isSafeInteger(value.expiryMs) || value.expiryMs <= 0)) {
    throw new HarnessError("spawn expiryMs must be a positive integer");
  }
  if (typeof value.envelopeRoot !== "string" || !value.envelopeRoot.startsWith("spawn:")) throw new HarnessError("spawn envelopeRoot is required");
  return {
    version: 1,
    parent,
    task,
    taskRoot: value.taskRoot,
    authority,
    contextRoot: value.contextRoot,
    dependencyRoot: value.dependencyRoot,
    skillSelectionReceipt: value.skillSelectionReceipt,
    evidenceReceipts: [...value.evidenceReceipts],
    knowledgeStateRoots: [...value.knowledgeStateRoots],
    returnContract: value.returnContract,
    ...(value.expiryMs !== undefined ? { expiryMs: value.expiryMs } : {}),
    envelopeRoot: value.envelopeRoot,
  };
}

function envelopeBody(envelope: SpawnEnvelopeV1): Record<string, unknown> {
  return {
    version: envelope.version,
    parent: envelope.parent,
    task: envelope.task,
    taskRoot: envelope.taskRoot,
    authority: envelope.authority,
    contextRoot: envelope.contextRoot,
    dependencyRoot: envelope.dependencyRoot,
    skillSelectionReceipt: envelope.skillSelectionReceipt,
    evidenceReceipts: envelope.evidenceReceipts,
    knowledgeStateRoots: envelope.knowledgeStateRoots,
    returnContract: envelope.returnContract,
    ...(envelope.expiryMs !== undefined ? { expiryMs: envelope.expiryMs } : {}),
  };
}

function intersectSpawn(parent: SpawnAuthorityV1, pack: SpawnAuthorityV1): SpawnAuthorityV1 {
  return {
    capabilities: parent.capabilities.filter(item => pack.capabilities.includes(item)),
    tools: parent.tools.filter(item => pack.tools.includes(item)),
    namespaces: parent.namespaces.filter(item => pack.namespaces.includes(item)),
    maxSteps: Math.min(parent.maxSteps, pack.maxSteps),
    maxCostMicros: Math.min(parent.maxCostMicros, pack.maxCostMicros),
  };
}

function applyBudget(authority: SpawnAuthorityV1, budget: HarnessBudgetV1): SpawnAuthorityV1 {
  return {
    ...authority,
    maxSteps: budget.maxSteps ?? authority.maxSteps,
    maxCostMicros: budget.maxCostMicros ?? authority.maxCostMicros,
  };
}

function assertBudgetWithin(budget: HarnessBudgetV1, ceiling: SpawnAuthorityV1): void {
  if (budget.maxSteps !== undefined && budget.maxSteps > ceiling.maxSteps) throw new HarnessError("spawn authority escalation");
  if (budget.maxCostMicros !== undefined && budget.maxCostMicros > ceiling.maxCostMicros) throw new HarnessError("spawn authority escalation");
}

function normalizeAuthority(value: SpawnAuthorityV1, label: string): SpawnAuthorityV1 {
  if (!value || typeof value !== "object") throw new HarnessError(`${label} is required`);
  if (!Number.isSafeInteger(value.maxSteps) || value.maxSteps <= 0) throw new HarnessError(`${label}.maxSteps must be a positive integer`);
  if (!Number.isSafeInteger(value.maxCostMicros) || value.maxCostMicros <= 0) throw new HarnessError(`${label}.maxCostMicros must be a positive integer`);
  return {
    capabilities: stringList(value.capabilities, `${label}.capabilities`),
    tools: stringList(value.tools, `${label}.tools`),
    namespaces: stringList(value.namespaces, `${label}.namespaces`),
    maxSteps: value.maxSteps,
    maxCostMicros: value.maxCostMicros,
  };
}

function stringList(value: readonly string[] | undefined, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item)) {
    throw new HarnessError(`${label} must be an array of non-empty strings`);
  }
  return uniqueSorted(value);
}

function descriptorOf(value: AgentDescriptorV1): AgentDescriptorV1 {
  if (!value || value.version !== 1) throw new HarnessError("spawn parent descriptor version must be 1");
  if (typeof value.id !== "string" || !value.id.trim() || value.id.length > 128) throw new HarnessError("spawn parent id is required");
  if (!LEVELS.has(value.level)) throw new HarnessError("spawn parent level is not a known assurance level");
  if (value.name !== undefined && typeof value.name !== "string") throw new HarnessError("spawn parent name must be a string");
  return {
    version: 1,
    id: value.id,
    level: value.level,
    ...(value.name ? { name: value.name } : {}),
  };
}

function parentAdapter(parent: AgentDescriptorV1 | AgentAdapter): AgentAdapter {
  if (isAdapter(parent)) return parent;
  const descriptor = descriptorOf(parent);
  return {
    descriptor: () => descriptor,
    capabilities: () => ({
      version: 1,
      level: descriptor.level,
      tools: true,
      resume: false,
      observe: false,
      interrupt: false,
      limitations: ["spawn parent; not invoked"],
    }),
    invoke: async () => {
      throw new HarnessError("issueSpawn does not invoke the parent");
    },
  };
}

function isAdapter(value: AgentDescriptorV1 | AgentAdapter): value is AgentAdapter {
  return typeof (value as AgentAdapter).invoke === "function" && typeof (value as AgentAdapter).descriptor === "function";
}
