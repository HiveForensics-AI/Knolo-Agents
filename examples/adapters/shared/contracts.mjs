import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function repoRoot() {
  return root;
}

export function sharedTask() {
  return JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/task-dummy-v1.json"), "utf8"));
}

export function ledgerPack() {
  return JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/skills/ledger-review.knolo.json"), "utf8"));
}

export function sharedEvidence() {
  return [
    {
      id: "ledger-pack",
      text: "cite supporting evidence from ledger-pack: identify suspicious transactions without irreversible actions",
      sourceId: "ledger-pack",
      required: true,
    },
  ];
}

export function sharedAuthority() {
  return { capabilities: ["ledger.read"] };
}

export function sharedSkills() {
  return { resolution: "local", packs: [ledgerPack()] };
}

export function sharedHarnessOptions(agent, extra = {}) {
  return {
    agent,
    task: sharedTask(),
    evidence: sharedEvidence(),
    skills: sharedSkills(),
    authority: sharedAuthority(),
    ...extra,
  };
}

export function promptFromContext(ctx, input) {
  const evidence = (ctx.envelope?.evidence ?? []).map(item => item.text ?? JSON.stringify(item)).join("\n");
  const skills = (ctx.envelope?.skills ?? []).map(item => item.text ?? item.id ?? JSON.stringify(item)).join("\n");
  const constraints = (ctx.envelope?.constraints ?? ctx.task.constraints ?? [])
    .map(item => `- ${item.description ?? item.id}`)
    .join("\n");
  const parts = [
    `Objective: ${ctx.task.objective}`,
    `Success criteria:\n${ctx.task.successCriteria.map(item => `- ${item}`).join("\n")}`,
  ];
  if (constraints) parts.push(`Constraints:\n${constraints}`);
  if (ctx.task.prohibitedActions?.length) parts.push(`Prohibited actions: ${ctx.task.prohibitedActions.join(", ")}`);
  if (evidence) parts.push(`Evidence:\n${evidence}`);
  if (skills) parts.push(`Skills:\n${skills}`);
  if (input !== undefined) parts.push(`Input: ${JSON.stringify(input)}`);
  parts.push("Cite supporting evidence. Do not perform irreversible actions.");
  return parts.join("\n\n");
}

export function vendorSmokeEnabled(name) {
  const flag = process.env.KNOLO_VENDOR_SMOKE ?? "";
  return flag === "1" || flag === name;
}
