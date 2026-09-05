import { uniqueSorted } from "../capabilities/authority.js";
import type { CapabilityIndex } from "../capabilities/catalog.js";
import type { TaskV1 } from "../harness/types.js";
import type {
  PublishPolicyV1,
  RegistryModeV1,
  SkillAcquisitionReceiptV1,
  SkillResolutionOptions,
  SkillTrustPolicyV1,
} from "./types.js";

export const ADAPTER_CAPABILITIES = new Set(["tools", "resume", "observe", "interrupt"]);

export function normalizeRegistry(value: boolean | RegistryModeV1 | undefined): RegistryModeV1 {
  if (value === undefined || value === false || value === "disabled") return "disabled";
  if (value === true) return "acquire-any-verified";
  return value;
}

export function normalizePublish(value: PublishPolicyV1 | undefined): PublishPolicyV1 {
  return value ?? "propose-only";
}

export function normalizeTrust(options?: Pick<SkillResolutionOptions, "registry" | "allowlist" | "publish">): SkillTrustPolicyV1 {
  return {
    registry: normalizeRegistry(options?.registry),
    ...(options?.allowlist && options.allowlist.length > 0 ? { allowlist: [...options.allowlist] } : {}),
    publish: normalizePublish(options?.publish),
  };
}

export function emptyAcquisition(
  registry: RegistryModeV1 = "disabled",
  publish: PublishPolicyV1 = "propose-only",
  gaps: readonly string[] = [],
  missingSkills: readonly string[] = [],
): SkillAcquisitionReceiptV1 {
  return {
    version: 1,
    registry,
    publish,
    gaps,
    missingSkills,
    queried: false,
    pulled: false,
    staged: [],
    candidates: [],
  };
}

export function capabilityGaps(
  task: TaskV1,
  index: CapabilityIndex,
  selectedIds: readonly string[] = [],
): string[] {
  const needed = (task.requiredCapabilities ?? []).filter(item => !ADAPTER_CAPABILITIES.has(item));
  const covered = new Set<string>();
  for (const id of selectedIds) {
    const entry = index.skill(id);
    if (!entry) continue;
    for (const capability of entry.skill.requiredCapabilities ?? []) covered.add(capability);
  }
  return uniqueSorted(needed.filter(item => !covered.has(item)));
}

export function missingPreferredSkills(task: TaskV1, index: CapabilityIndex): string[] {
  return uniqueSorted((task.preferredSkills ?? []).filter(id => !index.skill(id)));
}
