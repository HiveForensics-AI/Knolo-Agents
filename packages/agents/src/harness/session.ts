import { intersectAuthority, parseAuthorityGrant } from "../capabilities/authority.js";
import { CapabilityIndex } from "../capabilities/catalog.js";
import type { CapabilityMetadataV1 } from "../capabilities/types.js";
import { composeMemories, cortexMemory } from "../context/sources.js";
import { compileContext } from "../context/compiler.js";
import type { ContextBudgetV1, ContextSelectionReceiptV1, EvidenceItemV1, EvidenceSourceV1, MemoryItemV1, MemorySourceV1, SemanticRerankFn, SkillItemV1 } from "../context/types.js";
import type { JsonValue } from "../contracts/index.js";
import { canRemember, emptyReceipt, isCortex, LocalExperience, normalizeExperiencePolicy } from "../experience/store.js";
import type { ExperiencePolicyV1, ExperienceReceiptV1 } from "../experience/types.js";
import { loadCoreV5 } from "../core-v5/load.js";
import { DependencyActivation, freezeAwareRegistry, mergePackDependencies, packDependenciesFromLockfile, parseLockfile } from "../dependencies/index.js";
import { assertLockfileRegistry, type KnoloLockfileV1 } from "../dependencies/lockfile.js";
import type { HarnessDependencyRootV1, PackDependencyV1 } from "../dependencies/types.js";
import { runHooks, type Middleware, type MiddlewareContext } from "../middleware/index.js";
import { isPackRegistry, offlinePackRegistry, type PackRegistryCapabilityV1 } from "../registry/index.js";
import { evaluateRun, isAcsSuite, parseEvaluationSuite, scoreHarnessRun } from "../evaluation/index.js";
import type { AcsScore, AcsSuiteV1, EvaluationSuiteV1, SemanticJudgeFn } from "../evaluation/index.js";
import { classifyFailure, needsRecovery, nextStrategy, parseRecoveryPolicy } from "../recovery/index.js";
import type { RecoveryEventV1, RecoveryPolicyV1, RecoveryStrategyV1 } from "../recovery/index.js";
import { acquireSkills } from "../skills/acquire.js";
import { emptyAcquisition, normalizeTrust } from "../skills/policy.js";
import { indexFromOptions, parseHarnessSkills, resolveSkills } from "../skills/resolver.js";
import type { HarnessSkillsInput, SkillAcquisitionReceiptV1, SkillSelectionReceiptV1 } from "../skills/types.js";
import { digestRoot, sha256Bytes } from "./hash.js";
import { assertAdapterSupportsTask, emptyEnvelope, jsonValue } from "./lifecycle.js";
import { validateTask } from "./task.js";
import type {
  AgentAdapter,
  AgentInvocationResultV1,
  ContextEnvelopeV1,
  HarnessBudgetV1,
  HarnessContextV1,
  HarnessRunReceiptV1,
  TaskV1,
} from "./types.js";
import { HarnessError } from "./types.js";

export interface CreateHarnessOptions {
  readonly agent: AgentAdapter;
  readonly task: TaskV1;
  readonly knowledge?: readonly string[];
  readonly authority?: JsonValue;
  readonly memory?: boolean | JsonValue;
  readonly memories?: readonly MemoryItemV1[] | MemorySourceV1;
  readonly experience?: ExperiencePolicyV1;
  readonly evidence?: readonly EvidenceItemV1[] | EvidenceSourceV1;
  readonly skills?: HarnessSkillsInput;
  readonly contextBudget?: ContextBudgetV1;
  readonly semanticRerank?: SemanticRerankFn;
  readonly semanticRerankModel?: string;
  readonly registry?: PackRegistryCapabilityV1;
  readonly lockfile?: KnoloLockfileV1 | string;
  readonly offline?: boolean;
  readonly forceRegistry?: boolean;
  readonly evaluators?: EvaluationSuiteV1 | AcsSuiteV1 | JsonValue;
  readonly recovery?: RecoveryPolicyV1 | boolean | JsonValue;
  readonly judge?: SemanticJudgeFn;
  readonly limits?: HarnessBudgetV1;
  readonly middleware?: readonly Middleware[];
  readonly clock?: () => number;
  readonly runId?: string;
  readonly signal?: AbortSignal;
}

export interface HarnessRun {
  readonly result: AgentInvocationResultV1;
  readonly receipt: HarnessRunReceiptV1;
  readonly envelope: ContextEnvelopeV1;
  readonly selection: ContextSelectionReceiptV1;
  readonly skills: SkillSelectionReceiptV1 | null;
  readonly acquisition: SkillAcquisitionReceiptV1 | null;
  readonly experience: ExperienceReceiptV1 | null;
  readonly acs: AcsScore | null;
  readonly dependencies: HarnessDependencyRootV1;
  readonly staged: readonly PackDependencyV1[];
}

type SessionOptions = CreateHarnessOptions & {
  readonly task: TaskV1;
  readonly parsedLockfile?: KnoloLockfileV1;
  readonly boundRegistry?: PackRegistryCapabilityV1;
  readonly activation: DependencyActivation;
  readonly learner?: LocalExperience;
};

export class HarnessSession {
  private readonly acquiredPacks: CapabilityMetadataV1[] = [];

  private constructor(private readonly options: SessionOptions) {}

  static async create(options: CreateHarnessOptions): Promise<HarnessSession> {
    if (!options?.agent) throw new HarnessError("createHarness requires an AgentAdapter");
    const task = validateTask(options.task);
    assertAdapterSupportsTask(options.agent, task);
    const parsedLockfile = options.lockfile !== undefined ? parseLockfile(options.lockfile) : undefined;
    const activation = new DependencyActivation();
    const boundRegistry = bindRegistry(options.registry, options.offline === true, parsedLockfile, activation);
    if (parsedLockfile && boundRegistry?.origin) {
      assertLockfileRegistry(parsedLockfile, boundRegistry.origin, { force: options.forceRegistry === true });
    }
    const policy = normalizeExperiencePolicy(options.experience, options.memory);
    const remember = canRemember(options.memory) ? options.memory.remember.bind(options.memory) : undefined;
    const learner = policy.enabled
      ? new LocalExperience(
        {
          ...options.experience,
          remember,
          authorityCapabilities: parseAuthorityGrant(options.authority)?.capabilities,
        },
        options.memory,
      )
      : undefined;
    return new HarnessSession({ ...options, task, parsedLockfile, boundRegistry, activation, learner });
  }

  get registry(): PackRegistryCapabilityV1 | undefined {
    return this.options.boundRegistry;
  }

  get experience(): LocalExperience | undefined {
    return this.options.learner;
  }

  async run(input?: unknown): Promise<HarnessRun> {
    const runId = this.options.runId ?? `harness-${await digestRoot("run", { at: (this.options.clock ?? Date.now)() })}`;
    const adapter = this.options.agent;
    const task = this.options.task;
    const knowledge = this.options.knowledge ?? [];
    const activation = this.options.activation;
    activation.activateStaged();
    const resolvedSkills = await resolveHarnessSkills(
      this.options.skills,
      task,
      adapter,
      this.options.authority,
      this.acquiredPacks,
      this.options.boundRegistry,
      this.options.learner?.promoted() ?? [],
    );
    activation.replaceActive(
      mergePackDependencies(
        await collectRunDependencies(knowledge, this.options.parsedLockfile, resolvedSkills.receipt),
        activation.snapshot().active,
      ),
    );
    const frozen = await activation.freeze();
    const acquired = await maybeAcquireSkills(resolvedSkills, this.options, activation, this.acquiredPacks);
    if (acquired.packs.length > 0) this.acquiredPacks.push(...acquired.packs);
    if (resolvedSkills.receipt) {
      resolvedSkills.receipt = { ...resolvedSkills.receipt, registry: acquired.receipt.registry, acquisition: acquired.receipt };
    }
    const dependencyRoot = frozen.root;
    const budget = { ...(task.budget ?? {}), ...(this.options.limits ?? {}) };
    const envelope = emptyEnvelope(task, adapter.capabilities(), budget, dependencyRoot);
    const middleware = this.options.middleware ?? [];
    const hookCtx: MiddlewareContext = { runId, task, envelope, adapter };

    await runHooks(middleware, "beforeRun", hookCtx);
    await runHooks(middleware, "beforeContext", hookCtx);
    const compiled = await compileContext({
      task,
      capabilities: hookCtx.envelope.capabilities,
      budget,
      dependencyRoot: hookCtx.envelope.dependencyRoot,
      evidence: this.options.evidence,
      memories: composeMemories(
        this.options.learner,
        this.options.memories,
        isCortex(this.options.memory) ? cortexMemory(this.options.memory as unknown as import("../cortex/index.js").CortexCapability) : undefined,
      ),
      skills: resolvedSkills.items,
      contextBudget: this.options.contextBudget,
      semanticRerank: this.options.semanticRerank,
      semanticRerankModel: this.options.semanticRerankModel,
    });
    hookCtx.envelope = compiled.envelope;
    await runHooks(middleware, "onEvidence", hookCtx, compiled.envelope.evidence);
    await runHooks(middleware, "onSkillCandidates", hookCtx, resolvedSkills.receipt?.candidates ?? compiled.envelope.skills);
    await runHooks(middleware, "onSkillSelected", hookCtx, resolvedSkills.receipt?.selected ?? compiled.envelope.skills);

    const recoveryPolicy = parseRecoveryPolicy(this.options.recovery);
    const invoked = await invokeWithRecovery(adapter, input ?? task.inputs, hookCtx, middleware, this.options.signal, recoveryPolicy);
    const result = invoked.result;
    const toolReceipts = invoked.toolReceipts;
    await runHooks(middleware, "beforeComplete", hookCtx, result);

    const suite = parseEvaluationSuite(this.options.evaluators);
    const evaluation = await evaluateRun({
      task,
      result,
      toolCalls: result.toolCalls ?? toolReceipts,
      envelope: hookCtx.envelope,
      dependencies: frozen,
      evidenceReceipts: [compiled.selectionRoot],
      suite,
      judge: this.options.judge,
    });
    const descriptor = adapter.descriptor();
    const receipt: HarnessRunReceiptV1 = {
      version: 1,
      runId,
      agentDescriptorHash: await digestRoot("agent", descriptor),
      taskRoot: await digestRoot("task", task),
      inputRoot: await digestRoot("input", input ?? task.inputs ?? null),
      knowledgeStateRoots: knowledgeStateRoots(knowledge, compiled.envelope.evidence),
      harnessDependencyRoot: dependencyRoot,
      authorityRoot: await digestRoot("authority", this.options.authority ?? null),
      skillSelectionReceipt: resolvedSkills.receipt
        ? await digestRoot("skill-selection", resolvedSkills.receipt)
        : compiled.envelope.skills.length
          ? await digestRoot("skills", compiled.envelope.skills)
          : null,
      evidenceReceipts: [compiled.selectionRoot],
      toolReceipts: result.toolCalls ?? toolReceipts,
      evaluationReceipt: evaluation,
      recoveryEvents: invoked.events.map(item => jsonValue(item)),
      finalStatus: evaluation.prohibitedViolations.length ? "failed" : result.status,
      output: result.output,
    };

    const experience = this.options.learner
      ? await this.options.learner.record({
        runId,
        task,
        status: receipt.finalStatus,
        output: result.output,
        successCriteriaMatched: evaluation.successCriteriaMatched,
        prohibitedViolations: evaluation.prohibitedViolations,
        skillIds: resolvedSkills.receipt?.selected.map(item => item.id) ?? [],
        evidenceIds: compiled.selection.selected.filter(item => item.kind === "evidence").map(item => item.id),
        dependencyRoot,
      })
      : emptyReceipt();

    const acs = isAcsSuite(suite)
      ? scoreHarnessRun(suite, {
        output: result.output,
        toolCalls: result.toolCalls ?? toolReceipts,
        status: receipt.finalStatus,
        tokens: result.tokens,
      })
      : null;

    await runHooks(middleware, "afterComplete", hookCtx, receipt);
    return {
      result: { ...result, status: receipt.finalStatus },
      receipt,
      envelope: hookCtx.envelope,
      selection: compiled.selection,
      skills: resolvedSkills.receipt,
      acquisition: resolvedSkills.receipt ? acquired.receipt : null,
      experience: this.options.learner ? experience : null,
      acs,
      dependencies: frozen,
      staged: activation.snapshot().staged,
    };
  }
}

async function invokeWithRecovery(
  adapter: AgentAdapter,
  input: unknown,
  hookCtx: MiddlewareContext,
  middleware: readonly Middleware[],
  signal: AbortSignal | undefined,
  policy: RecoveryPolicyV1,
): Promise<{ result: AgentInvocationResultV1; toolReceipts: string[]; events: RecoveryEventV1[] }> {
  const events: RecoveryEventV1[] = [];
  const used: RecoveryStrategyV1[] = [];
  let attempt = 0;
  let toolReceipts: string[] = [];

  const invokeOnce = async (): Promise<AgentInvocationResultV1> => {
    toolReceipts = [];
    const ctx: HarnessContextV1 = {
      runId: hookCtx.runId,
      task: hookCtx.task,
      envelope: hookCtx.envelope,
      signal,
      emitTool: async (phase, toolId, payload) => {
        await runHooks(middleware, phase === "before" ? "beforeTool" : "afterTool", hookCtx, { toolId, payload });
        if (phase === "after") toolReceipts.push(toolId);
      },
    };
    await runHooks(middleware, "beforeAgent", hookCtx);
    try {
      return await adapter.invoke(input, ctx);
    } catch (error) {
      const result: AgentInvocationResultV1 = { status: "failed", output: null, error: error instanceof Error ? error.message : String(error) };
      await runHooks(middleware, "onError", hookCtx, result);
      return result;
    }
  };

  let result = await invokeOnce();
  while (needsRecovery(result)) {
    const failureClass = classifyFailure(result);
    const strategy = nextStrategy(policy, failureClass, used);
    if (!strategy) break;
    used.push(strategy);
    attempt += 1;
    await runHooks(middleware, "onRecovery", hookCtx, { result, strategy, class: failureClass });
    if (strategy === "graceful-partial") {
      result = { ...result, status: "partial", output: result.output ?? result.error ?? "partial" };
      events.push({ version: 1, class: failureClass, strategy, attempt, status: "applied", detail: "graceful-partial" });
      break;
    }
    events.push({ version: 1, class: failureClass, strategy, attempt, status: "applied" });
    result = await invokeOnce();
  }
  if (needsRecovery(result) && used.length > 0) {
    const failureClass = classifyFailure(result);
    events.push({ version: 1, class: failureClass, strategy: "graceful-partial", attempt: attempt + 1, status: "exhausted", detail: "no remaining strategy" });
  }
  return { result, toolReceipts, events };
}

function bindRegistry(
  registry: PackRegistryCapabilityV1 | undefined,
  offline: boolean,
  lockfile: KnoloLockfileV1 | undefined,
  activation: DependencyActivation,
): PackRegistryCapabilityV1 | undefined {
  if (registry === undefined) return undefined;
  if (!isPackRegistry(registry)) throw new HarnessError("createHarness registry must implement PackRegistryCapabilityV1");
  const bound = offline ? offlinePackRegistry(registry, { cache: registry.cache, lockfile }) : registry;
  return freezeAwareRegistry(bound, activation);
}

async function collectRunDependencies(
  knowledge: readonly string[],
  lockfile: KnoloLockfileV1 | undefined,
  skills: SkillSelectionReceiptV1 | null,
): Promise<PackDependencyV1[]> {
  const dependencies: PackDependencyV1[] = [...packDependenciesFromLockfile(lockfile)];
  const locked = new Set(Object.keys(lockfile?.packs ?? {}));
  for (const name of knowledge) {
    if (locked.has(name)) continue;
    dependencies.push({
      name,
      version: "local",
      sha256: await sha256Bytes(new TextEncoder().encode(name)),
      role: "knowledge",
    });
  }
  for (const skill of skills?.selected ?? []) {
    dependencies.push({
      name: skill.id,
      version: skill.skillVersion,
      sha256: skill.contentHash,
      role: "skill",
    });
  }
  return dependencies;
}

async function resolveHarnessSkills(
  value: CreateHarnessOptions["skills"],
  task: TaskV1,
  adapter: AgentAdapter,
  authority: JsonValue | undefined,
  acquiredPacks: readonly CapabilityMetadataV1[],
  boundRegistry: PackRegistryCapabilityV1 | undefined,
  promotedSkills: readonly import("../skills/types.js").SkillDefinitionV1[] = [],
): Promise<{ items?: SkillItemV1[]; receipt: SkillSelectionReceiptV1 | null; options?: ReturnType<typeof parseHarnessSkills>["options"] }> {
  const parsed = parseHarnessSkills(value);
  if (parsed.passthrough) return { items: parsed.passthrough, receipt: null };
  if (!parsed.options && promotedSkills.length === 0) return { items: undefined, receipt: null };
  const skillOptions = parsed.options ?? { resolution: "local" as const, registry: "disabled" as const };
  const trust = normalizeTrust(skillOptions);
  const resolution = skillOptions.resolution ?? "local";
  if (resolution === "auto" && trust.registry !== "disabled" && !boundRegistry) {
    throw new HarnessError("skill registry is not configured; Hub acquisition requires PackRegistryCapabilityV1");
  }
  const index = indexFromOptions(skillOptions);
  for (const pack of acquiredPacks) index.tryAdd(pack);
  const fresh = promotedSkills.filter(skill => !index.skill(skill.id));
  if (fresh.length > 0) {
    index.tryAdd({
      version: 1,
      packId: index.hasPack("local-experience") ? `local-experience/${fresh[0].id}` : "local-experience",
      role: "skill",
      capabilities: [],
      tools: [],
      namespaces: [],
      skills: fresh,
    });
  }
  const resolved = await resolveSkills({
    task,
    index,
    authority: intersectAuthority({
      parent: parseAuthorityGrant(authority),
      agent: adapter.capabilities(),
    }),
    trust,
    resolution,
  });
  return { items: resolved.items, receipt: resolved.receipt, options: skillOptions };
}

async function maybeAcquireSkills(
  resolved: { items?: SkillItemV1[]; receipt: SkillSelectionReceiptV1 | null; options?: ReturnType<typeof parseHarnessSkills>["options"] },
  options: SessionOptions,
  activation: DependencyActivation,
  acquiredPacks: readonly CapabilityMetadataV1[],
): Promise<{ receipt: SkillAcquisitionReceiptV1; packs: readonly CapabilityMetadataV1[] }> {
  const trust = normalizeTrust(resolved.options);
  const resolution = resolved.options?.resolution ?? "local";
  if (resolution !== "auto" || trust.registry === "disabled") {
    return { receipt: resolved.receipt?.acquisition ?? emptyAcquisition(trust.registry, trust.publish), packs: [] };
  }
  const registry = options.offline && options.registry
    ? offlinePackRegistry(options.registry, { cache: options.registry.cache, lockfile: options.parsedLockfile })
    : (options.registry ?? options.boundRegistry);
  if (!registry) {
    throw new HarnessError("skill registry is not configured; Hub acquisition requires PackRegistryCapabilityV1");
  }
  const index = resolved.options ? indexFromOptions(resolved.options) : CapabilityIndex.empty();
  for (const pack of acquiredPacks) index.tryAdd(pack);
  return acquireSkills({
    task: options.task,
    index,
    authority: intersectAuthority({
      parent: parseAuthorityGrant(options.authority),
      agent: options.agent.capabilities(),
    }),
    trust,
    registry,
    activation,
    selected: resolved.receipt?.selected,
    verifyImage: async bytes => {
      const core = await loadCoreV5();
      (core as unknown as { verifyKnowledgeImageV5: (value: Uint8Array) => unknown }).verifyKnowledgeImageV5(bytes);
    },
  });
}

function knowledgeStateRoots(declared: readonly string[], evidence: ContextEnvelopeV1["evidence"]): readonly string[] {
  const fromEvidence = evidence
    .map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const sourceId = (item as { readonly sourceId?: JsonValue }).sourceId;
      return typeof sourceId === "string" ? sourceId : null;
    })
    .filter((item): item is string => Boolean(item));
  const unique = [...new Set([...declared, ...fromEvidence])];
  return unique.sort();
}

export function createHarness(options: CreateHarnessOptions): Promise<HarnessSession> {
  return HarnessSession.create(options);
}

export function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export { jsonValue };
