import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CapabilityIndex,
  HarnessError,
  callableAgent,
  capabilityMetadataFromPack,
  createHarness,
  hashSkillDefinition,
  intersectAuthority,
  normalizeSkillDefinition,
  resolveSkills,
  toolAwareAgent,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const pack = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/skills/ledger-review.knolo.json"), "utf8"));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

const task = {
  objective: "Investigate these transactions for potential fraud.",
  successCriteria: ["identify suspicious transactions", "cite supporting evidence"],
  preferredSkills: ["ledger-review"],
};

const parent = { capabilities: ["ledger.read"], tools: ["search_ledger"], namespaces: ["examples.ledger"] };

function index() {
  return CapabilityIndex.fromPacks([pack]);
}

test("CapabilityIndex reads skill metadata from an existing .knolo JSON pack", () => {
  const metadata = capabilityMetadataFromPack(pack);
  assert.equal(metadata.packId, "examples.ledger-review");
  assert.equal(metadata.role, "skill");
  assert.deepEqual(metadata.capabilities, ["ledger.read"]);
  assert.deepEqual(metadata.tools, ["search_ledger"]);
  const catalog = index();
  assert.equal(catalog.skills().map(item => item.skill.id).join(","), "ledger-review,ledger-search,weather-chat,wire-send");
  assert.equal(catalog.skill("ledger-review").packId, "examples.ledger-review");
});

test("skill resolution is deterministic for the same local index", async () => {
  const input = {
    task,
    index: index(),
    authority: intersectAuthority({ parent, agent: { version: 1, level: "L0", tools: false, resume: false, observe: false, interrupt: false, limitations: [] } }),
    trust: { registry: "disabled" },
  };
  const first = await resolveSkills(input);
  const second = await resolveSkills(input);
  assert.deepEqual(first.receipt, second.receipt);
  assert.equal(first.receipt.lexical, true);
  assert.equal(first.receipt.registry, "disabled");
  assert.equal(first.receipt.resolution, "local");
  assert.equal(first.receipt.selected[0].id, "ledger-review");
  assert.equal(first.receipt.selected[0].required, true);
  assert.ok(first.receipt.selected[0].contentHash.length >= 64);
  assert.ok(first.receipt.rejected.some(item => item.id === "wire-send" && item.reason === "authority"));
  assert.ok(first.receipt.rejected.some(item => item.id === "ledger-search" && item.reason === "authority"));
  assert.equal(first.receipt.selected.some(item => item.id === "weather-chat"), false);
  assert.ok(first.receipt.candidates.some(item => item.id === "weather-chat" && item.score === 0));
});

test("unauthorized skills are denied and never enter the envelope", async () => {
  const { envelope, skills, receipt } = await (await createHarness({
    agent: callableAgent(async (_input, ctx) => ctx.envelope.skills.map(item => item.id).join(",")),
    task,
    authority: parent,
    skills: { resolution: "local", packs: [pack] },
    runId: "skill-deny",
  })).run();
  assert.deepEqual(envelope.skills.map(item => item.id), ["ledger-review"]);
  assert.equal(skills.selected.map(item => item.id).join(","), "ledger-review");
  assert.ok(skills.rejected.some(item => item.id === "wire-send"));
  assert.match(receipt.skillSelectionReceipt, /^skill-selection:/);
  assert.equal(envelope.skills.some(item => item.id === "wire-send"), false);
});

test("tool-aware agents can select skills that require granted tools", async () => {
  const { skills } = await (await createHarness({
    agent: toolAwareAgent({
      tools: { search_ledger: async () => ({ hits: 1 }) },
      invoke: async (_input, ctx) => ctx.envelope.skills.map(item => item.id).join(","),
    }),
    task: { ...task, requiredCapabilities: ["tools"] },
    authority: parent,
    skills: { packs: [pack] },
    runId: "skill-tools",
  })).run();
  assert.ok(skills.selected.some(item => item.id === "ledger-review"));
  assert.ok(skills.selected.some(item => item.id === "ledger-search"));
  assert.ok(skills.rejected.some(item => item.id === "wire-send" && item.reason === "authority"));
});

test("pinned skill missing from the local index fails closed", async () => {
  await assert.rejects(
    () => resolveSkills({
      task: { ...task, preferredSkills: ["not-in-index"] },
      index: index(),
      authority: intersectAuthority({ parent }),
    }),
    /pinned skill 'not-in-index' is not in the local capability index/,
  );
});

test("pinned skill whose required capabilities are not granted fails closed", async () => {
  await assert.rejects(
    () => resolveSkills({
      task: { ...task, preferredSkills: ["wire-send"] },
      index: index(),
      authority: intersectAuthority({ parent }),
    }),
    /pinned skill 'wire-send' is denied/,
  );
});

test("auto Hub acquisition without a registry capability fails closed", async () => {
  await assert.rejects(
    () => createHarness({
      agent: callableAgent(async () => "ok"),
      task,
      skills: { resolution: "auto", registry: true, packs: [pack] },
    }).then(session => session.run()),
    /skill registry is not configured/,
  );
});

test("contentHash mismatch fails closed", async () => {
  const [entry] = index().skills();
  const normalized = await normalizeSkillDefinition(entry.skill);
  await assert.rejects(
    () => normalizeSkillDefinition({ ...normalized, contentHash: "0".repeat(64) }),
    /contentHash does not match/,
  );
  assert.equal(normalized.contentHash, await hashSkillDefinition(normalized));
});

test("duplicate skill ids fail closed", () => {
  assert.throws(
    () => CapabilityIndex.fromPacks([pack, pack]),
    /duplicate pack in capability index/,
  );
  const catalog = CapabilityIndex.fromDefinitions([pack.skills[0]]);
  assert.throws(() => catalog.addDefinitions([pack.skills[0]], "other"), /duplicate skill in capability index/);
});

test("skills and capabilities modules do not import icp", () => {
  for (const dir of ["skills", "capabilities"]) {
    for (const file of walk(join(srcRoot, dir))) {
      const text = readFileSync(file, "utf8");
      assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
      assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
    }
  }
});
