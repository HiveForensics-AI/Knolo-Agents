import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HarnessError,
  LocalExperience,
  callableAgent,
  createHarness,
  localExperience,
  memoryPackRegistry,
  normalizeExperiencePolicy,
  patternKey,
} from "../dist/index.js";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

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
};

const output = "identify suspicious transactions and cite supporting evidence";

async function runTwiceThenThird(options = {}) {
  const session = await createHarness({
    agent: callableAgent(async () => output),
    task,
    memory: true,
    experience: { promote: "auto-approved", minUsefulness: 2, ...options.experience },
    ...options.harness,
  });
  const first = await session.run();
  const second = await session.run();
  const third = await session.run();
  return { session, first, second, third };
}

test("pattern keys are deterministic", async () => {
  const first = await patternKey(task);
  const second = await patternKey({ ...task, successCriteria: [...task.successCriteria].reverse() });
  assert.equal(first, second);
  assert.match(first, /^experience-pattern:[0-9a-f]{64}$/);
});

test("a successful local pattern promotes to a local skill without publishing", async () => {
  const { session, first, second, third } = await runTwiceThenThird();
  assert.equal(first.experience.recorded, true);
  assert.equal(first.experience.promoted, false);
  assert.equal(first.experience.publish, "disabled");
  assert.equal(second.experience.promoted, true);
  assert.equal(second.experience.publish, "disabled");
  assert.ok(third.envelope.skills.some(item => String(item.id).startsWith("learned/")));
  assert.ok(session.experience.promoted().length >= 1);
  assert.equal(session.experience.snapshot().candidates.every(item => item.publish === "disabled"), true);
});

test("repeated usefulness is required before promotion", async () => {
  const session = await createHarness({
    agent: callableAgent(async () => output),
    task,
    memory: true,
    experience: { promote: "auto-approved", minUsefulness: 2 },
  });
  const first = await session.run();
  assert.equal(first.experience.gates.usefulness, false);
  assert.equal(session.experience.promoted().length, 0);
});

test("failed evaluation does not count as useful", async () => {
  let n = 0;
  const session = await createHarness({
    agent: callableAgent(async () => {
      n += 1;
      return n === 2 ? "wire_transfer" : output;
    }),
    task: { ...task, prohibitedActions: ["wire_transfer"] },
    memory: true,
    experience: { promote: "auto-approved", minUsefulness: 2 },
  });
  await session.run();
  const second = await session.run();
  assert.equal(second.experience.promoted, false);
  assert.equal(second.receipt.finalStatus, "failed");
  const third = await session.run();
  assert.equal(third.experience.promoted, true);
});

test("require-approval does not promote until approved", async () => {
  const session = await createHarness({
    agent: callableAgent(async () => output),
    task,
    memory: true,
    experience: { promote: "require-approval", minUsefulness: 2 },
  });
  await session.run();
  const second = await session.run();
  assert.equal(second.experience.promoted, false);
  assert.equal(second.experience.gates.approval, false);
  const approved = await session.experience.approve(second.experience.lessonId);
  assert.equal(approved.status, "promoted");
  const third = await session.run();
  assert.ok(third.envelope.skills.some(item => String(item.id).startsWith("learned/")));
});

test("memory disabled records nothing", async () => {
  const { experience } = await (await createHarness({
    agent: callableAgent(async () => output),
    task,
    runId: "exp-off",
  })).run();
  assert.equal(experience, null);
});

test("public Hub publish stays disabled", () => {
  assert.throws(
    () => normalizeExperiencePolicy({ publish: "authorized" }, true),
    HarnessError,
  );
  const learner = localExperience({ promote: "disabled" }, true);
  assert.equal(learner.snapshot().candidates.length, 0);
});

test("experience never calls registry.publish", async () => {
  let published = 0;
  const registry = memoryPackRegistry();
  const original = registry.publish.bind(registry);
  registry.publish = async input => {
    published += 1;
    return original(input);
  };
  const session = await createHarness({
    agent: callableAgent(async () => output),
    task,
    memory: true,
    registry,
    experience: { promote: "auto-approved", minUsefulness: 1 },
  });
  await session.run();
  assert.equal(published, 0);
  assert.equal(session.experience.snapshot().candidates[0]?.publish, "disabled");
});

test("recall is deterministic for the same records", async () => {
  const learner = new LocalExperience({ promote: "disabled" }, true);
  await learner.record({
    runId: "a",
    task,
    status: "succeeded",
    output,
    successCriteriaMatched: task.successCriteria,
    prohibitedViolations: [],
    dependencyRoot: "root:1",
  });
  const first = learner.recall(task.objective);
  const second = learner.recall(task.objective);
  assert.deepEqual(first, second);
  assert.ok(first.length >= 1);
});

test("experience modules do not import icp", () => {
  for (const file of walk(join(srcRoot, "experience"))) {
    const text = readFileSync(file, "utf8");
    assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
    assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
  }
});
