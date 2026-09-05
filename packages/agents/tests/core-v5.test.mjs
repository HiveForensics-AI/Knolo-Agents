import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CORE_ABSENT_MESSAGE,
  CORE_V5_PEER,
  LegacyClaimGraphAdapter,
  LegacyCortexAdapter,
  V5ClaimGraphAdapter,
  V5CortexAdapter,
  V5DiagnosticsAdapter,
  V5KnowledgeAdapter,
  V5RunAdapter,
  commitClaimProposal,
  cortexQuery,
  requireCoreV5,
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

test("Core V5 peer bound and fail-closed without Core", () => {
  assert.equal(CORE_V5_PEER, "^5.1.0");
  assert.throws(() => requireCoreV5(null), new RegExp(CORE_ABSENT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.throws(() => V5KnowledgeAdapter.from(null), /Core V5 is required/);
});

test("legacy Cortex and ClaimGraph adapters still wrap host implementations", async () => {
  const cortex = new LegacyCortexAdapter({
    query: async request => ({ echo: request }),
    context: async request => ({ wrapped: request }),
  });
  assert.deepEqual(await cortexQuery(cortex, { q: 1 }), { echo: { q: 1 } });
  assert.deepEqual(await cortex.context({ q: 2 }), { wrapped: { q: 2 } });

  const claims = new LegacyClaimGraphAdapter({
    read: async query => ({ query }),
    commit: async proposal => ({ committed: proposal.justification }),
  });
  const committed = await commitClaimProposal(claims, { version: 1, operation: { add: true }, justification: "ok" }, { type: "policy", decisionId: "d1" });
  assert.equal(committed.committed, "ok");
});

test("core-v5, evaluation, harness, middleware, and context modules do not import icp", () => {
  const files = ["core-v5", "evaluation", "harness", "middleware", "context", "skills", "capabilities", "registry", "dependencies"].flatMap(dir => walk(join(srcRoot, dir)));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
    assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
  }
});

test("Core V5 knowledge, cortex, claim, and run adapters work with @knolo/core", async () => {
  let core;
  try {
    core = await import("@knolo/core");
  } catch (error) {
    assert.fail(`@knolo/core ^5.1.0 must be available as a devDependency: ${error}`);
  }

  const knowledge = V5KnowledgeAdapter.from(core);
  const handle = knowledge.createImage([{ kind: "metadata", bytes: new TextEncoder().encode("hello"), meta: { version: 1 } }]);
  assert.match(handle.stateRoot, /^sha256-/);
  assert.equal(knowledge.verify(handle.bytes).stateRoot, handle.stateRoot);
  const queried = knowledge.query(handle, "FROM metadata LIMIT 10");
  assert.equal(queried.hits.length, 1);

  const cortex = V5CortexAdapter.from(core);
  cortex.remember("suspicious ledger pattern", ["fraud"]);
  const recalled = await cortex.query({ query: "ledger", topK: 4 });
  assert.ok(Array.isArray(recalled));
  assert.ok(recalled.length >= 1);

  const claims = V5ClaimGraphAdapter.from(core);
  claims.fromDocuments([{ id: "doc-1", text: "See [alpha](beta) for the ledger." }]);
  const graph = await claims.read("");
  assert.equal(graph.version, 1);
  assert.ok(graph.nodes.length >= 1);
  const after = await commitClaimProposal(claims, { version: 1, operation: { kind: "note" }, justification: "reviewed" }, { type: "human", reviewer: "tester" });
  assert.ok(after.nodes.length >= graph.nodes.length);

  const runs = V5RunAdapter.from(core);
  const started = runs.start({ agentId: "fixture-agent", imageStateRoot: handle.stateRoot, input: { q: 1 }, now: 1 });
  assert.equal(started.status, "running");
  const completed = runs.complete(started, { ok: true }, 2);
  assert.equal(completed.status, "completed");

  const diagnostics = V5DiagnosticsAdapter.from(core);
  const inspected = diagnostics.inspect(handle.image);
  assert.equal(inspected.valid, true);
  assert.equal(inspected.image.stateRoot, handle.stateRoot);
});
