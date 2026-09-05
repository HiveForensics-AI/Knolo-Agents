import { HarnessError } from "../harness/types.js";
import type { SkillDefinitionInputV1 } from "../skills/types.js";
import { uniqueSorted } from "./authority.js";
import type { CapabilityMetadataV1, CapabilityRoleV1 } from "./types.js";

/** Read capability metadata from an existing `.knolo` JSON pack. Not a new binary format. */
export function capabilityMetadataFromPack(pack: unknown): CapabilityMetadataV1 {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new HarnessError("pack metadata must be an object");
  const record = pack as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) throw new HarnessError("pack metadata requires id");
  const authority = asRecord(record.authority) ?? {};
  const embedded = asRecord(record.capabilityMetadata);
  const capabilities = uniqueSorted([
    ...(asStringArray(authority.capabilities) ?? []),
    ...(asStringArray(record.capabilities) ?? []),
    ...(asStringArray(embedded?.capabilities) ?? []),
  ]);
  const tools = uniqueSorted([
    ...(asStringArray(record.tools) ?? []),
    ...(asStringArray(embedded?.tools) ?? []),
  ]);
  const namespaces = uniqueSorted([
    ...(asStringArray(authority.namespaces) ?? []),
    ...(asStringArray(record.namespaces) ?? []),
    ...(asStringArray(embedded?.namespaces) ?? []),
  ]);
  const skills = [
    ...(asArray(record.skills) ?? []),
    ...(asArray(embedded?.skills) ?? []),
  ] as SkillDefinitionInputV1[];
  const role = parseRole(embedded?.role ?? record.role) ?? (skills.length > 0 ? "skill" : "knowledge");
  const digest = typeof record.digest === "string" ? record.digest : typeof embedded?.digest === "string" ? embedded.digest : undefined;
  const license = typeof record.license === "string" ? record.license : typeof embedded?.license === "string" ? embedded.license : undefined;
  return {
    version: 1,
    packId: record.id,
    ...(digest ? { digest } : {}),
    role,
    capabilities,
    tools,
    namespaces,
    skills,
    ...(license ? { license } : {}),
  };
}

function parseRole(value: unknown): CapabilityRoleV1 | undefined {
  if (value === "knowledge" || value === "skill" || value === "policy" || value === "evaluation" || value === "workflow") return value;
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) return undefined;
  return value;
}
