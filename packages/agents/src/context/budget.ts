import { HarnessError } from "../harness/types.js";
import { isRedundant } from "./lexical.js";
import type { ContextBudgetV1, ContextDropV1, ContextItemKindV1, ContextSelectionEntryV1 } from "./types.js";

export interface RankedContextItem {
  readonly kind: ContextItemKindV1;
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly required: boolean;
  readonly sourceId?: string;
}

export interface BudgetPlan {
  readonly selected: RankedContextItem[];
  readonly entries: ContextSelectionEntryV1[];
  readonly dropped: ContextDropV1[];
  readonly maxChars: number;
  readonly usedChars: number;
}

/** Convert token budget to chars. 4 chars/token is the documented estimator. */
export function maxCharsFromBudget(budget: ContextBudgetV1 | undefined): number {
  if (!budget) return Number.MAX_SAFE_INTEGER;
  if (budget.maxChars !== undefined) {
    if (!Number.isSafeInteger(budget.maxChars) || budget.maxChars <= 0) throw new HarnessError("contextBudget.maxChars must be a positive integer");
    return budget.maxChars;
  }
  if (budget.maxTokens !== undefined) {
    if (!Number.isSafeInteger(budget.maxTokens) || budget.maxTokens <= 0) throw new HarnessError("contextBudget.maxTokens must be a positive integer");
    return budget.maxTokens * 4;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Fill context in priority order: required evidence, other evidence, constraints, skills, memories.
 * Required items never drop for budget; overflow fails closed.
 */
export function applyBudget(items: readonly RankedContextItem[], budget: ContextBudgetV1 | undefined): BudgetPlan {
  const maxChars = maxCharsFromBudget(budget);
  const selected: RankedContextItem[] = [];
  const entries: ContextSelectionEntryV1[] = [];
  const dropped: ContextDropV1[] = [];
  const selectedTexts: string[] = [];
  let usedChars = 0;

  for (const item of items) {
    const chars = item.text.length;
    if (isRedundant(item.text, selectedTexts)) {
      dropped.push({ kind: item.kind, id: item.id, reason: "redundant" });
      continue;
    }
    if (usedChars + chars > maxChars) {
      if (item.required) {
        throw new HarnessError(`required ${item.kind} '${item.id}' exceeds context budget (${usedChars + chars} > ${maxChars} chars)`);
      }
      dropped.push({ kind: item.kind, id: item.id, reason: "budget" });
      continue;
    }
    selected.push(item);
    selectedTexts.push(item.text);
    usedChars += chars;
    entries.push({ kind: item.kind, id: item.id, chars, score: item.score, required: item.required });
  }

  return { selected, entries, dropped, maxChars, usedChars };
}

export function compareRank(left: RankedContextItem, right: RankedContextItem): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.id.localeCompare(right.id);
}
