import type { AgentCapabilitiesV1, ConstraintV1, ContextEnvelopeV1, HarnessBudgetV1, TaskV1 } from "../harness/types.js";
import { digestRoot } from "../harness/hash.js";
import { applyBudget, compareRank, type RankedContextItem } from "./budget.js";
import { lexicalScore } from "./lexical.js";
import type {
  ContextBudgetV1,
  ContextSelectionReceiptV1,
  EvidenceItemV1,
  EvidenceSourceV1,
  MemoryItemV1,
  MemorySourceV1,
  SemanticRerankFn,
  SemanticRerankRecordV1,
  SkillItemV1,
} from "./types.js";
import { asJsonItem } from "./types.js";

export interface CompileContextInput {
  readonly task: TaskV1;
  readonly capabilities: AgentCapabilitiesV1;
  readonly budget: HarnessBudgetV1;
  readonly dependencyRoot: string;
  readonly evidence?: readonly EvidenceItemV1[] | EvidenceSourceV1;
  readonly memories?: readonly MemoryItemV1[] | MemorySourceV1;
  readonly skills?: readonly SkillItemV1[];
  readonly contextBudget?: ContextBudgetV1;
  readonly semanticRerank?: SemanticRerankFn;
  readonly semanticRerankModel?: string;
}

export interface CompiledContext {
  readonly envelope: ContextEnvelopeV1;
  readonly selection: ContextSelectionReceiptV1;
  readonly selectionRoot: string;
}

export async function compileContext(input: CompileContextInput): Promise<CompiledContext> {
  const query = input.task.objective;
  const evidence = markRequired(await resolveEvidence(input.evidence, query), input.task.evidenceRequirements ?? []);
  const reranked = input.semanticRerank ? await input.semanticRerank(evidence, query) : evidence;
  const semanticRerank: SemanticRerankRecordV1 | null = input.semanticRerank
    ? { kind: "external-effect", effect: "semantic-rerank", deterministic: false, ...(input.semanticRerankModel ? { model: input.semanticRerankModel } : {}) }
    : null;

  const { required: requiredEvidence, rest: extraEvidence } = splitEvidence(reranked, query, Boolean(input.semanticRerank));
  const constraints = (input.task.constraints ?? []).map(constraint => rankedConstraint(constraint));
  const skills = [...(input.skills ?? [])]
    .map(skill => rankedSkill(skill, query))
    .sort((left, right) => Number(right.required) - Number(left.required) || compareRank(left, right));
  const memories = [...(await resolveMemories(input.memories, query))]
    .map(memory => rankedMemory(memory, query))
    .sort(compareRank);

  const plan = applyBudget([...requiredEvidence, ...constraints, ...extraEvidence, ...skills, ...memories], input.contextBudget);
  const selectedEvidence = plan.selected.filter(item => item.kind === "evidence");
  const selectedConstraints = plan.selected.filter(item => item.kind === "constraint");
  const selectedSkills = plan.selected.filter(item => item.kind === "skill");
  const selectedMemories = plan.selected.filter(item => item.kind === "memory");

  const selection: ContextSelectionReceiptV1 = {
    version: 1,
    query,
    lexical: true,
    selected: plan.entries,
    dropped: plan.dropped,
    budget: { maxChars: plan.maxChars, usedChars: plan.usedChars },
    semanticRerank,
  };
  const selectionRoot = await digestRoot("context-selection", selection);
  const envelope: ContextEnvelopeV1 = {
    task: input.task,
    evidence: selectedEvidence.map(item => asJsonItem(item)),
    memories: selectedMemories.map(item => asJsonItem(item)),
    skills: selectedSkills.map(item => asJsonItem(item)),
    constraints: selectedConstraints.map(item => ({ id: item.id, description: item.text })),
    capabilities: input.capabilities,
    budget: input.budget,
    dependencyRoot: input.dependencyRoot,
    receipts: [selectionRoot],
  };
  return { envelope, selection, selectionRoot };
}

async function resolveEvidence(source: CompileContextInput["evidence"], query: string): Promise<EvidenceItemV1[]> {
  if (!source) return [];
  if (Array.isArray(source)) return source.map(item => ({ ...item, score: item.score ?? lexicalScore(query, item.text) }));
  return [...(await (source as EvidenceSourceV1).retrieve(query))];
}

async function resolveMemories(source: CompileContextInput["memories"], query: string): Promise<MemoryItemV1[]> {
  if (!source) return [];
  if (Array.isArray(source)) return source.map(item => ({ ...item, score: item.score ?? lexicalScore(query, item.text) }));
  return [...(await (source as MemorySourceV1).recall(query))];
}

function markRequired(items: readonly EvidenceItemV1[], requirements: readonly string[]): EvidenceItemV1[] {
  if (requirements.length === 0) return items.map(item => (item.required ? { ...item, required: true } : item));
  const needed = requirements.map(item => item.toLowerCase());
  const claimed = new Set<string>();
  return items.map(item => {
    const hay = `${item.id} ${item.sourceId ?? ""} ${item.text}`.toLowerCase();
    if (item.required) {
      for (const req of needed) if (hay.includes(req)) claimed.add(req);
      return { ...item, required: true };
    }
    const match = needed.find(req => !claimed.has(req) && hay.includes(req));
    if (!match) return item;
    claimed.add(match);
    return { ...item, required: true };
  });
}

function splitEvidence(items: readonly EvidenceItemV1[], query: string, preserveOrder: boolean): { required: RankedContextItem[]; rest: RankedContextItem[] } {
  const required = items.filter(item => item.required).map(item => rankedEvidence(item, query)).sort((left, right) => left.id.localeCompare(right.id));
  const rest = items.filter(item => !item.required).map(item => rankedEvidence(item, query));
  if (!preserveOrder) rest.sort(compareRank);
  return { required, rest };
}

function rankedEvidence(item: EvidenceItemV1, query: string): RankedContextItem {
  return {
    kind: "evidence",
    id: item.id,
    text: item.text,
    score: item.score ?? lexicalScore(query, item.text),
    required: item.required === true,
    ...(item.sourceId ? { sourceId: item.sourceId } : {}),
  };
}

function rankedConstraint(constraint: ConstraintV1): RankedContextItem {
  return { kind: "constraint", id: constraint.id, text: constraint.description, score: 0, required: true };
}

function rankedSkill(skill: SkillItemV1, query: string): RankedContextItem {
  return {
    kind: "skill",
    id: skill.id,
    text: skill.text,
    score: skill.score ?? lexicalScore(query, skill.text),
    required: skill.required === true,
    ...(skill.sourceId ? { sourceId: skill.sourceId } : {}),
  };
}

function rankedMemory(memory: MemoryItemV1, query: string): RankedContextItem {
  return { kind: "memory", id: memory.id, text: memory.text, score: memory.score ?? lexicalScore(query, memory.text), required: false };
}
