import type { JsonValue } from "../contracts/index.js";

export interface EvidenceItemV1 {
  readonly id: string;
  readonly text: string;
  readonly sourceId?: string;
  readonly required?: boolean;
  readonly score?: number;
}

export interface MemoryItemV1 {
  readonly id: string;
  readonly text: string;
  readonly score?: number;
}

export interface SkillItemV1 {
  readonly id: string;
  readonly text: string;
  readonly required?: boolean;
  readonly score?: number;
  readonly sourceId?: string;
}

export interface ContextBudgetV1 {
  readonly maxChars?: number;
  readonly maxTokens?: number;
}

export type ContextItemKindV1 = "evidence" | "constraint" | "skill" | "memory";

export interface ContextSelectionEntryV1 {
  readonly kind: ContextItemKindV1;
  readonly id: string;
  readonly chars: number;
  readonly score: number;
  readonly required: boolean;
}

export interface ContextDropV1 {
  readonly kind: ContextItemKindV1;
  readonly id: string;
  readonly reason: "budget" | "redundant";
}

export interface SemanticRerankRecordV1 {
  readonly kind: "external-effect";
  readonly effect: "semantic-rerank";
  readonly deterministic: false;
  readonly model?: string;
}

export interface ContextSelectionReceiptV1 {
  readonly version: 1;
  readonly query: string;
  readonly lexical: true;
  readonly selected: readonly ContextSelectionEntryV1[];
  readonly dropped: readonly ContextDropV1[];
  readonly budget: { readonly maxChars: number; readonly usedChars: number };
  readonly semanticRerank: SemanticRerankRecordV1 | null;
}

export interface EvidenceSourceV1 {
  retrieve(query: string): Promise<readonly EvidenceItemV1[]> | readonly EvidenceItemV1[];
}

export interface MemorySourceV1 {
  recall(query: string): Promise<readonly MemoryItemV1[]> | readonly MemoryItemV1[];
}

export type SemanticRerankFn = (
  items: readonly EvidenceItemV1[],
  query: string,
) => readonly EvidenceItemV1[] | Promise<readonly EvidenceItemV1[]>;

export function asJsonItem(item: { id: string; text: string; sourceId?: string }): JsonValue {
  return item.sourceId ? { id: item.id, text: item.text, sourceId: item.sourceId } : { id: item.id, text: item.text };
}
