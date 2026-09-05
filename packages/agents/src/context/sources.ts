import type { CortexCapability } from "../cortex/index.js";
import type { JsonValue } from "../contracts/index.js";
import type { KnowledgeImageHandleV5, V5KnowledgeAdapter } from "../core-v5/knowledge.js";
import { lexicalScore } from "./lexical.js";
import type { EvidenceItemV1, EvidenceSourceV1, MemoryItemV1, MemorySourceV1 } from "./types.js";

export function staticEvidence(items: readonly EvidenceItemV1[]): EvidenceSourceV1 {
  return {
    retrieve(query) {
      return [...items]
        .map(item => ({ ...item, score: item.score ?? lexicalScore(query, item.text) }))
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id));
    },
  };
}

export function staticMemories(items: readonly MemoryItemV1[]): MemorySourceV1 {
  return {
    recall(query) {
      return [...items]
        .map(item => ({ ...item, score: item.score ?? lexicalScore(query, item.text) }))
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id));
    },
  };
}

export function knowledgeEvidence(adapter: V5KnowledgeAdapter, images: readonly KnowledgeImageHandleV5[]): EvidenceSourceV1 {
  return {
    retrieve(query) {
      const q = query.replace(/\s+/g, " ").trim();
      const items: EvidenceItemV1[] = [];
      for (const image of images) {
        adapter.query(image, "FROM * LIMIT 100");
        for (const object of adapter.objects(image)) {
          items.push({
            id: object.id,
            text: object.text,
            sourceId: image.stateRoot,
            score: lexicalScore(q, object.text),
          });
        }
      }
      return items.sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id));
    },
  };
}

export function composeMemories(...sources: Array<MemorySourceV1 | readonly MemoryItemV1[] | undefined>): MemorySourceV1 {
  return {
    async recall(query) {
      const items: MemoryItemV1[] = [];
      const seen = new Set<string>();
      for (const source of sources) {
        if (!source) continue;
        const rows = Array.isArray(source)
          ? [...source]
          : [...(await (source as MemorySourceV1).recall(query))];
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          items.push({ ...row, score: row.score ?? lexicalScore(query, row.text) });
        }
      }
      return items.sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.id.localeCompare(right.id));
    },
  };
}

export function cortexMemory(cortex: Pick<CortexCapability<JsonValue, JsonValue>, "query">): MemorySourceV1 {
  return {
    async recall(query) {
      const recalled = await cortex.query({ query });
      const rows = Array.isArray(recalled) ? recalled : [];
      return rows.map((row, index) => {
        const record = row && typeof row === "object" && !Array.isArray(row) ? (row as { id?: unknown; text?: unknown }) : {};
        const text = typeof record.text === "string" ? record.text : JSON.stringify(row);
        const id = typeof record.id === "string" ? record.id : `memory-${index}`;
        return { id, text, score: lexicalScore(query, text) };
      });
    },
  };
}
