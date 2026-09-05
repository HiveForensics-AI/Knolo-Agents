import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HarnessError,
  V5CortexAdapter,
  V5KnowledgeAdapter,
  callableAgent,
  compileContext,
  cortexMemory,
  createHarness,
  knowledgeEvidence,
  staticEvidence,
  staticMemories,
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

const capabilities = { version: 1, level: "L0", tools: false, resume: false, observe: false, interrupt: false, limitations: [] };
const task = {
  objective: "Identify suspicious ledger transactions",
  successCriteria: ["identify suspicious transactions"],
  evidenceRequirements: ["ledger-pack"],
  constraints: [{ id: "no-wire", description: "do not perform irreversible actions" }],
};

function compileArgs(over = {}) {
  return {
    task,
    capabilities,
    budget: { timeoutMs: 5000 },
    dependencyRoot: "knolo.harness.dependencies.v1:test",
    evidence: [
      { id: "ev-required", text: "ledger-pack: tx-104 is suspicious", required: true },
      { id: "ev-extra", text: "weather in paris is cloudy" },
      { id: "ev-dup", text: "ledger-pack: tx-104 is suspicious" },
    ],
    skills: [{ id: "skill-review", text: "review ledger anomalies in order" }],
    memories: [{ id: "mem-old", text: "yesterday we looked at invoices" }],
    ...over,
  };
}

test("context compilation is deterministic for the same inputs", async () => {
  const first = await compileContext(compileArgs());
  const second = await compileContext(compileArgs());
  assert.deepEqual(first.selection, second.selection);
  assert.equal(first.selectionRoot, second.selectionRoot);
  assert.deepEqual(first.envelope.evidence, second.envelope.evidence);
  assert.equal(first.selection.lexical, true);
  assert.equal(first.selection.semanticRerank, null);
  assert.equal(first.envelope.evidence[0].id, "ev-required");
  assert.equal(String(first.envelope.evidence[0].text).includes("ledger-pack"), true);
  assert.ok(first.selection.dropped.some(item => item.id === "ev-dup" && item.reason === "redundant"));
});

test("budget truncates memories then skills then extra evidence; required evidence never drops", async () => {
  const required = "ledger-pack: tx-104 is suspicious";
  const compiled = await compileContext(compileArgs({
    contextBudget: { maxChars: required.length + "do not perform irreversible actions".length },
  }));
  const kinds = compiled.selection.selected.map(item => item.kind);
  assert.deepEqual(kinds, ["evidence", "constraint"]);
  assert.equal(compiled.envelope.evidence.length, 1);
  assert.equal(compiled.envelope.memories.length, 0);
  assert.ok(compiled.selection.dropped.some(item => item.kind === "memory" && item.reason === "budget"));
  assert.ok(compiled.selection.dropped.some(item => item.kind === "skill" && item.reason === "budget"));
});

test("required evidence that cannot fit the budget fails closed", async () => {
  await assert.rejects(
    () => compileContext(compileArgs({ contextBudget: { maxChars: 8 } })),
    /required evidence 'ev-required' exceeds context budget/,
  );
});

test("semantic rerank is recorded as a non-deterministic external effect", async () => {
  const compiled = await compileContext(compileArgs({
    evidence: [
      { id: "a", text: "alpha ledger" },
      { id: "b", text: "beta ledger" },
    ],
    semanticRerank: items => [...items].reverse(),
    semanticRerankModel: "host-rerank-test",
  }));
  assert.equal(compiled.selection.lexical, true);
  assert.deepEqual(compiled.selection.semanticRerank, {
    kind: "external-effect",
    effect: "semantic-rerank",
    deterministic: false,
    model: "host-rerank-test",
  });
  assert.equal(compiled.envelope.evidence[0].id, "b");
});

test("createHarness compiles evidence into the envelope and selection receipt", async () => {
  const { envelope, receipt, selection } = await (await createHarness({
    agent: callableAgent(async (_input, ctx) => ctx.envelope.evidence.map(item => item.id).join(",")),
    task,
    runId: "ctx-run",
    evidence: staticEvidence([
      { id: "ev-required", text: "ledger-pack: tx-104 is suspicious", required: true },
      { id: "ev-noise", text: "unrelated sports scores" },
    ]),
    memories: staticMemories([{ id: "mem-1", text: "prior fraud pattern on ledger" }]),
    skills: [{ id: "skill-1", text: "inspect the ledger" }],
  })).run();
  assert.equal(envelope.evidence[0].id, "ev-required");
  assert.equal(receipt.evidenceReceipts.length, 1);
  assert.match(receipt.evidenceReceipts[0], /^context-selection:/);
  assert.equal(selection.selected.some(item => item.id === "ev-required"), true);
});

test("Core V5 knowledge images and Cortex recall feed the compiler", async () => {
  let core;
  try {
    core = await import("@knolo/core");
  } catch (error) {
    assert.fail(`@knolo/core is required for this test: ${error}`);
  }
  const knowledge = V5KnowledgeAdapter.from(core);
  const image = knowledge.createImage([
    { kind: "chunk", bytes: new TextEncoder().encode("ledger-pack: tx-104 is suspicious"), meta: { title: "ledger" } },
  ]);
  const fromImage = await compileContext(compileArgs({
    evidence: knowledgeEvidence(knowledge, [image]),
    memories: undefined,
    skills: undefined,
  }));
  assert.ok(fromImage.envelope.evidence.length >= 1);
  assert.equal(fromImage.envelope.evidence.some(item => String(item.text).includes("suspicious")), true);

  const cortex = V5CortexAdapter.from(core);
  cortex.remember("prior suspicious ledger pattern", ["fraud"]);
  const withMemory = await compileContext(compileArgs({
    evidence: [],
    memories: cortexMemory(cortex),
    skills: undefined,
  }));
  assert.ok(withMemory.envelope.memories.length >= 1);
});

test("context modules do not import icp", () => {
  for (const file of walk(join(srcRoot, "context"))) {
    const text = readFileSync(file, "utf8");
    assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
    assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
  }
});
