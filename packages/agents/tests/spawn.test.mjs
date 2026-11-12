import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { HarnessError, assertSpawnAuthority, closeSpawn, digestRoot, handoffFromSpawn, issueSpawn } from "../dist/index.js";
import { sharedEvidence, sharedSkills, sharedTask } from "../../../examples/adapters/shared/contracts.mjs";
import { runGrokBuildParent } from "../../../examples/adapters/grok-build/grok-build-agent.mjs";
import { loadVendorFixture, recordedComplete } from "../../../examples/adapters/shared/recorded.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envelopePath = resolve(root, "contracts/fixtures/harness/spawn-envelope-v1.json");
const receiptPath = resolve(root, "contracts/fixtures/harness/spawn-receipt-v1.json");

const authority = {
  capabilities: ["ledger.read"],
  tools: [],
  namespaces: ["examples.ledger"],
  maxSteps: 8,
  maxCostMicros: 1000,
};
const pack = {
  capabilities: ["ledger.read", "payments.send"],
  tools: ["search_ledger"],
  namespaces: ["examples.ledger", "examples.payments"],
  maxSteps: 16,
  maxCostMicros: 5000,
};
const output = "identify suspicious transactions and cite supporting evidence; do not perform irreversible actions";

function parent() {
  return {
    descriptor: () => ({ version: 1, id: "parent", level: "L1" }),
    capabilities: () => ({ version: 1, level: "L1", tools: true, resume: false, observe: false, interrupt: false, limitations: [] }),
    invoke: async () => {
      throw new Error("issueSpawn invoked the parent");
    },
  };
}

function spawnOptions(extra = {}) {
  return {
    parent: parent(),
    task: sharedTask(),
    authority,
    pack,
    evidence: sharedEvidence(),
    skills: sharedSkills(),
    returnContract: "spawn.return.v1",
    expiryMs: 1893456000000,
    runId: "spawn-fixture",
    clock: () => 1,
    ...extra,
  };
}

test("issueSpawn returns an inert envelope and does not invoke the parent", async () => {
  const issued = await issueSpawn(spawnOptions());
  assert.equal(issued.envelope.version, 1);
  assert.equal(issued.envelope.parent.id, "parent");
  assert.equal(issued.envelope.returnContract, "spawn.return.v1");
  assert.deepEqual(issued.envelope.authority, {
    capabilities: ["ledger.read"],
    tools: [],
    namespaces: ["examples.ledger"],
    maxSteps: 8,
    maxCostMicros: 1000,
  });
  assert.equal(issued.context.evidence.some(item => item.sourceId === "ledger-pack"), true);
  assert.equal(issued.context.skills.some(item => item.id === "ledger-review"), true);
  assert.equal(JSON.stringify(issued.envelope).includes("model"), false);
  const { envelopeRoot, ...body } = issued.envelope;
  assert.equal(envelopeRoot, await digestRoot("spawn", body));

  if (process.env.WRITE_SPAWN_FIXTURE === "1") {
    const receipt = await closeSpawn(issued.envelope, output, { status: "succeeded", toolCalls: ["knolo.retrieve"] });
    writeFileSync(envelopePath, `${JSON.stringify(issued.envelope, null, 2)}\n`);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }

  const fixture = JSON.parse(readFileSync(envelopePath, "utf8"));
  assert.deepEqual(issued.envelope, fixture);
  const savedReceipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const closed = await closeSpawn(fixture, output, { status: "succeeded", toolCalls: ["knolo.retrieve"] });
  assert.deepEqual(closed, savedReceipt);
  assert.equal(closed.evaluation.passed, true);
  assert.deepEqual(closed.evaluation.successCriteriaMatched, sharedTask().successCriteria);
  assert.equal(closed.finalStatus, "succeeded");
});

test("spawn authority escalation fails closed", async () => {
  await assert.rejects(
    () => issueSpawn(spawnOptions({ task: { ...sharedTask(), budget: { maxSteps: 9, timeoutMs: 5000 } } })),
    HarnessError,
  );
  await assert.rejects(
    () => issueSpawn(spawnOptions({
      projection: { capabilities: ["payments.send"], tools: [], namespaces: ["examples.ledger"], maxSteps: 8, maxCostMicros: 1000 },
    })),
    /escalation/,
  );
  await assert.rejects(
    () => issueSpawn(spawnOptions({
      projection: { capabilities: ["ledger.read"], tools: [], namespaces: ["examples.payments"], maxSteps: 8, maxCostMicros: 1000 },
    })),
    /escalation/,
  );
  await assert.rejects(
    () => issueSpawn(spawnOptions({
      projection: { capabilities: ["ledger.read"], tools: ["search_ledger"], namespaces: ["examples.ledger"], maxSteps: 8, maxCostMicros: 1000 },
    })),
    /escalation/,
  );
  await assert.rejects(
    () => issueSpawn(spawnOptions({
      projection: { capabilities: ["ledger.read"], tools: [], namespaces: ["examples.ledger"], maxSteps: 9, maxCostMicros: 1000 },
    })),
    /escalation/,
  );
  await assert.rejects(
    () => issueSpawn(spawnOptions({
      projection: { capabilities: ["ledger.read"], tools: [], namespaces: ["examples.ledger"], maxSteps: 8, maxCostMicros: 1001 },
    })),
    /escalation/,
  );
  assert.throws(
    () => assertSpawnAuthority(
      { capabilities: ["ledger.read", "payments.send"], tools: [], namespaces: [], maxSteps: 1, maxCostMicros: 1 },
      authority,
      pack,
    ),
    /escalation/,
  );
});

test("recorded Grok Build parent issues a spawn, answers, and closes it", async () => {
  const run = await runGrokBuildParent(recordedComplete(loadVendorFixture("grok-chat-v1.json").turns), {
    runId: "spawn-grok-build",
  });
  assert.equal(run.result.toolCalls.includes("knolo.retrieve"), true);
  assert.equal(run.receipt.finalStatus, "succeeded");
  assert.equal(run.receipt.evaluation.passed, true);
  assert.equal(run.issued.envelope.parent.id, "grok-build");
});

test("handoffFromSpawn projects a verified envelope and does not start a worker", async () => {
  const issued = await issueSpawn(spawnOptions());
  const handoff = await handoffFromSpawn(issued.envelope, {
    destination: "portable-counter",
    stateProjection: { count: "count" },
  });
  assert.equal(handoff.version, 1);
  assert.equal(handoff.destination, "portable-counter");
  assert.equal(handoff.returnContract, issued.envelope.returnContract);
  assert.deepEqual(handoff.stateProjection, { count: "count" });
  assert.deepEqual(handoff.authorityProjection, {
    capabilities: ["ledger.read"],
    namespaces: ["examples.ledger"],
    maxSteps: 8,
    maxCostMicros: 1000,
  });
  assert.equal("tools" in handoff.authorityProjection, false);
  await assert.rejects(
    () => handoffFromSpawn({ ...issued.envelope, envelopeRoot: `spawn:${"0".repeat(64)}` }, { destination: "portable-counter" }),
    /root mismatch/,
  );
  await assert.rejects(() => handoffFromSpawn(issued.envelope, { destination: "  " }), /destination/);
});

test("closeSpawn refuses a prohibited tool and a tampered envelope", async () => {
  const issued = await issueSpawn(spawnOptions());
  await assert.rejects(
    () => closeSpawn(issued.envelope, output, { toolCalls: ["wire_transfer"] }),
    /prohibited tool/,
  );
  await assert.rejects(
    () => closeSpawn({ ...issued.envelope, envelopeRoot: `spawn:${"0".repeat(64)}` }, output),
    /root mismatch/,
  );
  const partial = await closeSpawn(issued.envelope, "not the criteria", { status: "succeeded", toolCalls: [] });
  assert.equal(partial.evaluation.checks.find(check => check.id === "successCriteria").passed, false);
});
