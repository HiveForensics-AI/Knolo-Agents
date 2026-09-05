import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DependencyActivation,
  HarnessError,
  callableAgent,
  canonicalCbor,
  computeHarnessDependencyRoot,
  createHarness,
  memoryPackRegistry,
  parseLockfile,
  sortPackDependencies,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const golden = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/dependency-root-v1.json"), "utf8"));
const lockfile = parseLockfile(readFileSync(resolve(root, "contracts/fixtures/harness/registry/knolo.lock.json"), "utf8"));
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/registry/manifest-v1.json"), "utf8"));
const bytes = new Uint8Array(readFileSync(resolve(root, "contracts/fixtures/harness/registry/pack-bytes.txt")));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

const sample = [
  { name: "acme/refund-policy", version: "1.2.0", sha256: "fca3f4f7338eb74ea56da96a1bdbba879384a5eebc8369e340beaa65972a9018", role: "knowledge" },
  { name: "ledger-review", version: "1.0.0", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", role: "skill" },
];

test("dependency root is deterministic and order-independent", async () => {
  const first = await computeHarnessDependencyRoot(sample);
  const second = await computeHarnessDependencyRoot([...sample].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.algorithm, "knolo.harness.dependencies.v1");
  assert.match(first.root, /^knolo\.harness\.dependencies\.v1:[0-9a-f]{64}$/);
  assert.deepEqual(first.dependencies.map(item => item.name), ["acme/refund-policy", "ledger-review"]);
});

test("golden HarnessDependencyRootV1 fixture matches the canonical digest", async () => {
  const computed = await computeHarnessDependencyRoot(golden.dependencies);
  assert.equal(computed.root, golden.root);
  assert.deepEqual(computed.dependencies, golden.dependencies);
});

test("local canonical CBOR matches Core V5 when Core is present", async () => {
  const payload = sortPackDependencies(sample).map(item => ({
    name: item.name,
    role: item.role,
    sha256: item.sha256,
    version: item.version,
  }));
  const local = canonicalCbor(payload);
  let core;
  try {
    core = await import("@knolo/core");
  } catch (error) {
    assert.fail(`@knolo/core is required for this test: ${error}`);
  }
  const fromCore = core.canonicalCbor(payload);
  assert.deepEqual([...local], [...fromCore]);
  const withCore = await computeHarnessDependencyRoot(sample, { canonicalCbor: value => core.canonicalCbor(value) });
  const without = await computeHarnessDependencyRoot(sample);
  assert.equal(withCore.root, without.root);
});

test("activation freezes the run set and stages later packs", async () => {
  const activation = new DependencyActivation();
  activation.add(sample[0]);
  const frozen = await activation.freeze();
  assert.throws(() => activation.add(sample[1]), /dependency set is frozen/);
  activation.stage(sample[1]);
  assert.equal(activation.root.root, frozen.root);
  assert.equal(activation.snapshot().staged.length, 1);
  activation.activateStaged();
  const next = await activation.freeze();
  assert.notEqual(next.root, frozen.root);
  assert.equal(next.dependencies.length, 2);
});

test("registry pull after freeze stages for the next run and does not change this root", async () => {
  let pulled = false;
  const extra = { ...manifest, name: "acme/extra-pack", version: "3.0.0" };
  const registry = memoryPackRegistry({
    origin: lockfile.registry,
    packs: [
      { manifest, bytes },
      { manifest: extra, bytes },
    ],
  });
  const session = await createHarness({
    agent: callableAgent(async () => "ok"),
    task: { objective: "x", successCriteria: ["ok"] },
    lockfile,
    registry,
    runId: "dep-stage",
    middleware: [{
      beforeAgent: async () => {
        if (!pulled) {
          pulled = true;
          await session.registry.pull("acme/extra-pack@3.0.0");
        }
      },
    }],
  });
  const first = await session.run();
  assert.equal(first.dependencies.dependencies.map(item => item.name).join(","), "acme/refund-policy");
  assert.equal(first.receipt.harnessDependencyRoot, first.dependencies.root);
  assert.deepEqual(first.staged.map(item => item.name), ["acme/extra-pack"]);
  assert.equal(first.dependencies.dependencies.some(item => item.name === "acme/extra-pack"), false);

  const second = await session.run();
  assert.equal(second.staged.length, 0);
  assert.deepEqual(second.dependencies.dependencies.map(item => item.name), ["acme/extra-pack", "acme/refund-policy"]);
  assert.notEqual(second.dependencies.root, first.dependencies.root);
});

test("dependencies modules do not import icp", () => {
  for (const file of walk(join(srcRoot, "dependencies"))) {
    const text = readFileSync(file, "utf8");
    assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
    assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
  }
});
