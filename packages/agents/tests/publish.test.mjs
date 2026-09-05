import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HarnessError,
  V5KnowledgeAdapter,
  assertNoSecrets,
  buildCapabilityPack,
  callableAgent,
  createHarness,
  decodeCapabilityPack,
  knoloMcpBridge,
  memoryPackRegistry,
  publishLearnedSkill,
} from "../dist/index.js";
import { grokBuildAgent } from "../../../examples/adapters/grok-build/grok-build-agent.mjs";
import { loadVendorFixture, recordedComplete } from "../../../examples/adapters/shared/recorded.mjs";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const task = {
  objective: "Investigate these transactions for potential fraud.",
  successCriteria: ["identify suspicious transactions", "cite supporting evidence"],
};
const output = "identify suspicious transactions and cite supporting evidence";

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

async function promoteCandidate() {
  const session = await createHarness({
    agent: callableAgent(async () => output),
    task,
    memory: true,
    experience: { promote: "auto-approved", minUsefulness: 2 },
  });
  await session.run();
  await session.run();
  const candidate = session.experience.snapshot().candidates.find(item => item.status === "promoted");
  assert.ok(candidate);
  return candidate;
}

test("buildCapabilityPack wraps skill metadata in a Core V5 image", async () => {
  const core = await import("@knolo/core");
  const knowledge = V5KnowledgeAdapter.from(core);
  const candidate = await promoteCandidate();
  const built = await buildCapabilityPack({
    spec: "acme/learned-fraud@1.0.0",
    skill: candidate.skill,
    knowledge,
  });
  assert.equal(built.manifest.format, "V5");
  assert.match(built.sha256, /^[0-9a-f]{64}$/);
  assert.equal(knowledge.verify(built.bytes).stateRoot, built.stateRoot);
  const decoded = await decodeCapabilityPack(built.bytes, { knowledge, digest: built.sha256 });
  assert.equal(decoded.skills[0].id, candidate.skill.id);
  assert.equal(decoded.packId, "acme/learned-fraud");
});

test("publishLearnedSkill publishes to a fixture Hub and a second Grok Build harness pulls it", async () => {
  const candidate = await promoteCandidate();
  const registry = memoryPackRegistry({ origin: "memory://hub" });
  const published = await publishLearnedSkill({
    candidate,
    spec: "acme/learned-fraud@1.0.0",
    registry,
    policy: "authorized",
    evaluation: { passed: true },
    approval: true,
  });
  assert.equal(published.decision, "published");
  assert.equal(published.secrets, "clean");
  assert.equal(published.manifest.name, "acme/learned-fraud");

  const pulled = await registry.pull("acme/learned-fraud@1.0.0");
  assert.equal(pulled.manifest.sha256, published.sha256);

  const session = await createHarness({
    agent: grokBuildAgent({
      complete: recordedComplete(loadVendorFixture("grok-chat-v1.json").turns),
      tools: "mcp",
      mcp: knoloMcpBridge(),
    }),
    task: { ...task, preferredSkills: [candidate.skill.id] },
    registry,
    skills: { resolution: "auto", registry: "acquire-approved", allowlist: ["acme/learned-fraud"] },
    runId: "publish-grok-build",
  });
  const first = await session.run();
  assert.equal(first.acquisition.pulled, true);
  assert.deepEqual(first.acquisition.staged.map(item => item.name), ["acme/learned-fraud"]);
  assert.equal(first.envelope.skills.some(item => item.id === candidate.skill.id), false);

  const second = await session.run();
  assert.ok(second.envelope.skills.some(item => item.id === candidate.skill.id));
  assert.equal(second.receipt.evaluationReceipt.passed, true);
  assert.deepEqual(second.receipt.evaluationReceipt.successCriteriaMatched, task.successCriteria);
});

test("propose-only builds a pack but does not call registry.publish", async () => {
  const candidate = await promoteCandidate();
  const registry = memoryPackRegistry();
  let calls = 0;
  const original = registry.publish.bind(registry);
  registry.publish = async input => {
    calls += 1;
    return original(input);
  };
  const proposed = await publishLearnedSkill({
    candidate,
    spec: "acme/learned-fraud@1.0.0",
    registry,
    policy: "propose-only",
    evaluation: { passed: true },
    approval: true,
  });
  assert.equal(proposed.decision, "proposed");
  assert.equal(calls, 0);
  await assert.rejects(() => registry.resolve("acme/learned-fraud@1.0.0"), /not found/);
});

test("authorized publish fails closed without approval, failing eval, or secrets", async () => {
  const candidate = await promoteCandidate();
  const registry = memoryPackRegistry();
  await assert.rejects(
    () => publishLearnedSkill({
      candidate,
      spec: "acme/learned-fraud@1.0.0",
      registry,
      policy: "authorized",
      evaluation: { passed: true },
    }),
    /explicit approval/,
  );
  await assert.rejects(
    () => publishLearnedSkill({
      candidate,
      spec: "acme/learned-fraud@1.0.0",
      registry,
      policy: "authorized",
      evaluation: { passed: false },
      approval: true,
    }),
    /passing evaluation/,
  );
  assert.throws(() => assertNoSecrets({ instructions: "token sk-abcdefghijklmnopqrstuvwxyz" }), /secret/);
  const dirty = {
    ...candidate,
    skill: { ...candidate.skill, instructions: `${candidate.skill.instructions} Bearer kno_secretvalue1` },
  };
  await assert.rejects(
    () => publishLearnedSkill({
      candidate: dirty,
      spec: "acme/learned-fraud@1.0.0",
      registry,
      policy: "authorized",
      evaluation: { passed: true },
      approval: true,
    }),
    HarnessError,
  );
});

test("publish modules do not import icp", () => {
  for (const file of walk(join(srcRoot, "skills"))) {
    const text = readFileSync(file, "utf8");
    assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
    assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
  }
});
