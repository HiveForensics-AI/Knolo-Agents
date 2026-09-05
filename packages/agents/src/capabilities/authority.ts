import type { AgentCapabilitiesV1 } from "../harness/types.js";
import type { AuthorityGrantV1, EffectiveAuthorityV1 } from "./types.js";

export function parseAuthorityGrant(value: unknown): AuthorityGrantV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const capabilities = asStringArray(record.capabilities);
  const tools = asStringArray(record.tools);
  const namespaces = asStringArray(record.namespaces);
  if (!capabilities && !tools && !namespaces) return undefined;
  return {
    capabilities: uniqueSorted(capabilities ?? []),
    tools: uniqueSorted(tools ?? []),
    namespaces: uniqueSorted(namespaces ?? []),
  };
}

export function intersectAuthority(parts: {
  readonly parent?: AuthorityGrantV1;
  readonly agent?: AgentCapabilitiesV1;
  readonly host?: AuthorityGrantV1;
  readonly policy?: AuthorityGrantV1;
}): EffectiveAuthorityV1 {
  const grants = [parts.parent, parts.host, parts.policy].filter((item): item is AuthorityGrantV1 => Boolean(item));
  let capabilities: string[] = [];
  let tools: string[] = [];
  let namespaces: string[] = [];
  if (grants.length > 0) {
    capabilities = intersectLists(grants.map(grant => grant.capabilities));
    tools = intersectLists(grants.map(grant => grant.tools));
    namespaces = intersectLists(grants.map(grant => grant.namespaces ?? []));
  }
  if (parts.agent && !parts.agent.tools) tools = [];
  return { capabilities, tools, namespaces };
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function intersectLists(lists: readonly (readonly string[])[]): string[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return uniqueSorted(first.filter(item => rest.every(list => list.includes(item))));
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.some(item => typeof item !== "string")) return undefined;
  return value as string[];
}
