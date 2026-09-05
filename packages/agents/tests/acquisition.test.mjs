import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  callableAgent,
  createHarness,
  memoryPackRegistry,
  sha256Bytes,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const ledger = JSON.parse(readFileSync(resolve(root, "contracts/fixtures/harness/skills/ledger-review.knolo.json"), "utf8"));
const kycBytes = new Uint8Array(readFileSync(resolve(root, "contracts/fixtures/harness/acquisition/kyc-review.knolo.json")));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function packRecord(name, version, bytes, description, yanked = false) {
  return {
    manifest: {
      name,
      version,
      sha256: null,
      url: `memory://${name}`,
      sizeBytes: bytes.byteLength,
      yanked,
      license: "Apache-2.0",
    },
    bytes,
    description,
  };
}

const paymentsPack = {
  version: 1,
  id: "acme/wire-pack",
  metadata: { description: "payments.send wire skill" },
  authority: { capabilities: ["payments.send"] },
  skills: [{
    version: 1,
    id: "wire-remote",
    skillVersion: "1.0.0",
    triggers: ["wire transfer"],
    domains: ["payments"],
    instructions: "Send a wire. Must stay denied without payments.send.",
    requiredCapabilities: ["payments.send"],
    requiredTools: [],
    knowledgeRefs: [],
    provenance: { source: "local-pack", packId: "acme/wire-pack" },
  }],
};

const otherPack = {
  version: 1,
  id: "acme/other-review",
  metadata: { description: "kyc.read other pack not on allowlist" },
  authority: { capabilities: ["kyc.read"] },
  skills: [{
    version: 1,
    id: "other-kyc",
    skillVersion: "1.0.0",
    triggers: ["kyc.read"],
    domains: ["kyc"],
    instructions: "Alternate KYC skill.",
    requiredCapabilities: ["kyc.read"],
    requiredTools: [],
    knowledgeRefs: [],
    provenance: { source: "local-pack", packId: "acme/other-review" },
  }],
};

async function kycRegistry(extra = []) {
  const records = [
    packRecord("acme/kyc-review", "1.0.0", kycBytes, "Hub skill pack covering kyc.read"),
    packRecord("acme/wire-pack", "1.0.0", new TextEncoder().encode(JSON.stringify(paymentsPack)), "payments.send wire skill"),
    packRecord("acme/other-review", "1.0.0", new TextEncoder().encode(JSON.stringify(otherPack)), "kyc.read other pack not on allowlist"),
    ...extra,
  ];
  for (const record of records) {
    record.manifest.sha256 = await sha256Bytes(record.bytes);
  }
  return memoryPackRegistry({ packs: records });
}

const task = {
  objective: "Complete a kyc.read identity review.",
  successCriteria: ["cite supporting evidence"],
  requiredCapabilities: ["kyc.read"],
};

const authority = { capabilities: ["kyc.read", "ledger.read"], tools: [], namespaces: ["examples.kyc"] };

test("disabled registry never downloads even when a Hub is configured", async () => {
  const registry = await kycRegistry();
  const { acquisition, staged, envelope } = await (await createHarness({
    agent: callableAgent(async () => "ok"),
    task,
    authority,
    registry,
    skills: { resolution: "auto", registry: "disabled", packs: [ledger] },
    runId: "acq-disabled",
  })).run();
  assert.equal(acquisition.registry, "disabled");
  assert.equal(acquisition.queried, false);
  assert.equal(acquisition.pulled, false);
  assert.equal(staged.length, 0);
  assert.equal(envelope.skills.some(item => item.id === "kyc-review"), false);
});

test("discover searches Hub but does not pull or stage", async () => {
  const registry = await kycRegistry();
  const { acquisition, staged, envelope } = await (await createHarness({
    agent: callableAgent(async () => "ok"),
    task,
    authority,
    registry,
    skills: { resolution: "auto", registry: "discover", packs: [ledger] },
    runId: "acq-discover",
  })).run();
  assert.equal(acquisition.queried, true);
  assert.equal(acquisition.pulled, false);
  assert.equal(acquisition.staged.length, 0);
  assert.equal(staged.length, 0);
  assert.ok(acquisition.candidates.some(item => item.name === "acme/kyc-review" && item.decision === "discover"));
  assert.equal(envelope.skills.some(item => item.id === "kyc-review"), false);
});

test("acquire-approved without allowlist fails closed", async () => {
  const registry = await kycRegistry();
  await assert.rejects(
    () => createHarness({
      agent: callableAgent(async () => "ok"),
      task,
      authority,
      registry,
      skills: { resolution: "auto", registry: "acquire-approved", packs: [ledger] },
    }).then(session => session.run()),
    /acquire-approved requires a pack allowlist/,
  );
});

test("acquire-approved stages the allowlisted pack for the next run only", async () => {
  const registry = await kycRegistry();
  const session = await createHarness({
    agent: callableAgent(async (_input, ctx) => ctx.envelope.skills.map(item => item.id).join(",")),
    task,
    authority,
    registry,
    skills: { resolution: "auto", registry: "acquire-approved", allowlist: ["acme/kyc-review"], packs: [ledger] },
    runId: "acq-allowlist",
  });
  const first = await session.run();
  assert.equal(first.acquisition.pulled, true);
  assert.deepEqual(first.acquisition.staged.map(item => item.name), ["acme/kyc-review"]);
  assert.equal(first.acquisition.publish, "propose-only");
  assert.equal(first.envelope.skills.some(item => item.id === "kyc-review"), false);
  assert.equal(first.dependencies.dependencies.some(item => item.name === "acme/kyc-review"), false);
  assert.equal(first.acquisition.candidates.some(item => item.name === "acme/other-review" && item.decision === "staged"), false);

  const second = await session.run();
  assert.equal(second.staged.length, 0);
  assert.ok(second.envelope.skills.some(item => item.id === "kyc-review"));
  assert.ok(second.skills.selected.some(item => item.id === "kyc-review"));
  assert.ok(second.dependencies.dependencies.some(item => item.name === "acme/kyc-review" && item.role === "skill"));
  assert.notEqual(second.dependencies.root, first.dependencies.root);
});

test("acquire-any-verified never grants authority the parent does not already have", async () => {
  const registry = await kycRegistry();
  const { acquisition, envelope } = await (await createHarness({
    agent: callableAgent(async () => "ok"),
    task: { ...task, requiredCapabilities: ["payments.send"], objective: "Send a payments.send wire" },
    authority,
    registry,
    skills: { resolution: "auto", registry: true, packs: [ledger] },
    runId: "acq-authority",
  })).run();
  assert.equal(envelope.skills.some(item => item.id === "wire-remote"), false);
  assert.ok(acquisition.candidates.some(item => item.name === "acme/wire-pack" && item.reason === "authority"));
  assert.equal(acquisition.staged.some(item => item.name === "acme/wire-pack"), false);
});

test("auto registry without PackRegistryCapabilityV1 fails closed", async () => {
  await assert.rejects(
    () => createHarness({
      agent: callableAgent(async () => "ok"),
      task,
      skills: { resolution: "auto", registry: true, packs: [ledger] },
    }).then(session => session.run()),
    /skill registry is not configured/,
  );
});

test("skills acquisition modules do not import icp", () => {
  for (const dir of ["skills", "capabilities", "registry", "dependencies", "harness"]) {
    for (const file of walk(join(srcRoot, dir))) {
      const text = readFileSync(file, "utf8");
      assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
      assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
    }
  }
});
