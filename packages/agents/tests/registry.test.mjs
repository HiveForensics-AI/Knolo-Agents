import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HarnessError,
  callableAgent,
  createHarness,
  httpPackRegistry,
  memoryPackRegistry,
  parseLockfile,
  parsePackSpec,
  sha256Bytes,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const fixtureDir = resolve(root, "contracts/fixtures/harness/registry");
const bytes = new Uint8Array(readFileSync(resolve(fixtureDir, "pack-bytes.txt")));
const manifest = JSON.parse(readFileSync(resolve(fixtureDir, "manifest-v1.json"), "utf8"));
const yanked = JSON.parse(readFileSync(resolve(fixtureDir, "yanked-v1.json"), "utf8"));
const searchBody = JSON.parse(readFileSync(resolve(fixtureDir, "search-v1.json"), "utf8"));
const lockfile = JSON.parse(readFileSync(resolve(fixtureDir, "knolo.lock.json"), "utf8"));

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function recordedFetch(options = {}) {
  const blobCalls = options.blobCalls ?? [];
  return async (url, init = {}) => {
    const href = String(url);
    if (href.includes("/api/v1/packs/acme/refund-policy/0.0.1/yank") || href.endsWith("/0.0.1/yank")) {
      const headers = init.headers ?? {};
      const auth = headers.authorization ?? headers.Authorization;
      if (auth !== "Bearer kno_test") return jsonResponse({ error: "Sign in required.", code: "unauthenticated" }, 401);
      return jsonResponse({ manifest: { ...yanked, yanked: true } });
    }
    if (href.includes("/api/v1/packs/acme/refund-policy/1.2.0")) return jsonResponse(manifest);
    if (href.includes("/api/v1/packs/acme/refund-policy/0.0.1")) return jsonResponse(yanked, 410);
    if (href.includes("/api/v1/packs/acme/refund-policy/9.9.9")) return jsonResponse({ error: "Pack version not found.", code: "not_found" }, 404);
    if (href.includes("/api/v1/packs")) return jsonResponse(searchBody);
    if (href.startsWith("https://blob.example/")) {
      blobCalls.push({ url: href, headers: init.headers ?? {} });
      const headers = init.headers ?? {};
      assert.equal(headers.authorization ?? headers.Authorization, undefined);
      return new Response(bytes, { status: 200 });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
}

test("memory registry search, pull, yank, and digest verify", async () => {
  const registry = memoryPackRegistry({
    packs: [{ manifest, bytes, description: "Customer support refund policy" }],
  });
  const hits = await registry.search({ q: "refund" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "acme/refund-policy");
  const pulled = await registry.pull("acme/refund-policy@1.2.0");
  assert.equal(pulled.manifest.sha256, manifest.sha256);
  assert.equal(pulled.bytes.byteLength, bytes.byteLength);
  assert.equal(await sha256Bytes(pulled.bytes), manifest.sha256);

  await registry.yank("acme/refund-policy@1.2.0");
  await assert.rejects(() => registry.resolve("acme/refund-policy@1.2.0"), /410 yanked/);
});

test("HTTP registry uses recorded Hub fixtures and never sends tokens to Blob", async () => {
  const blobCalls = [];
  const registry = httpPackRegistry({
    baseUrl: "https://hub.knolo.dev/",
    fetch: recordedFetch({ blobCalls }),
    token: "kno_test",
  });
  const hits = await registry.search({ q: "refund" });
  assert.equal(hits[0].name, "acme/refund-policy");
  const resolved = await registry.resolve("acme/refund-policy@1.2.0");
  assert.equal(resolved.sha256, manifest.sha256);
  const pulled = await registry.pull("acme/refund-policy@1.2.0");
  assert.equal(await sha256Bytes(pulled.bytes), manifest.sha256);
  assert.equal(blobCalls.length, 1);
  await assert.rejects(() => registry.resolve("acme/refund-policy@0.0.1"), /410 yanked/);
  await assert.rejects(() => registry.resolve("acme/refund-policy@9.9.9"), /404 not_found/);
});

test("yanked versions fail closed unless force is set", async () => {
  const forced = httpPackRegistry({
    baseUrl: "https://hub.knolo.dev",
    fetch: recordedFetch(),
    force: true,
  });
  const manifest410 = await forced.resolve("acme/refund-policy@0.0.1");
  assert.equal(manifest410.yanked, true);
});

test("offline mode uses the pinned cache and does not fetch", async () => {
  const cache = httpPackRegistry({
    baseUrl: "https://hub.knolo.dev",
    fetch: recordedFetch(),
  });
  await cache.pull("acme/refund-policy@1.2.0");
  const offline = httpPackRegistry({
    baseUrl: "https://hub.knolo.dev",
    fetch: async () => {
      throw new Error("network should not be used offline");
    },
    cache: cache.cache,
    lockfile,
    offline: true,
  });
  const pulled = await offline.pull("acme/refund-policy@1.2.0");
  assert.equal(await sha256Bytes(pulled.bytes), manifest.sha256);
  await assert.rejects(() => offline.search({ q: "refund" }), /unavailable offline/);
  await assert.rejects(
    () => httpPackRegistry({
      baseUrl: "https://hub.knolo.dev",
      fetch: async () => {
        throw new Error("network should not be used offline");
      },
      offline: true,
    }).pull("acme/refund-policy@1.2.0"),
    /offline/,
  );
});

test("lockfile mixed registries fail closed without force", async () => {
  const parsed = parseLockfile(lockfile);
  assert.equal(parsed.registry, "https://hub.knolo.dev");
  assert.equal(parsePackSpec("acme/refund-policy").version, "latest");

  await assert.rejects(
    () => createHarness({
      agent: callableAgent(async () => "ok"),
      task: { objective: "x", successCriteria: ["ok"] },
      registry: httpPackRegistry({ baseUrl: "https://other.example", fetch: recordedFetch() }),
      lockfile,
    }),
    /refusing to mix registries/,
  );

  const session = await createHarness({
    agent: callableAgent(async () => "ok"),
    task: { objective: "x", successCriteria: ["ok"] },
    registry: httpPackRegistry({ baseUrl: "https://hub.knolo.dev", fetch: recordedFetch() }),
    lockfile,
    runId: "lock-ok",
  });
  const { receipt } = await session.run();
  assert.match(receipt.harnessDependencyRoot, /^knolo\.harness\.dependencies\.v1:/);

  const forced = await createHarness({
    agent: callableAgent(async () => "ok"),
    task: { objective: "x", successCriteria: ["ok"] },
    registry: httpPackRegistry({ baseUrl: "https://other.example", fetch: recordedFetch() }),
    lockfile,
    forceRegistry: true,
  });
  assert.ok(forced);
});

test("lockfile pin digest conflict fails closed", async () => {
  const registry = memoryPackRegistry({
    lockfile: parseLockfile({
      registry: "memory://packs",
      packs: { "acme/refund-policy": { version: "1.2.0", sha256: "0".repeat(64) } },
    }),
    packs: [{ manifest, bytes }],
  });
  await assert.rejects(() => registry.pull("acme/refund-policy@1.2.0"), /different digest/);
});

test("HTTP yank sends the bearer token only to Hub", async () => {
  const registry = httpPackRegistry({
    baseUrl: "https://hub.knolo.dev",
    fetch: recordedFetch(),
    token: "kno_test",
  });
  const result = await registry.yank("acme/refund-policy@0.0.1");
  assert.equal(result.yanked, true);
});

test("registry and dependencies modules do not import icp", () => {
  for (const dir of ["registry", "dependencies"]) {
    for (const file of walk(join(srcRoot, dir))) {
      const text = readFileSync(file, "utf8");
      assert.equal(/from ["']\.\.\/icp/.test(text), false, file);
      assert.equal(/IcpAgentRuntimeClient/.test(text), false, file);
    }
  }
});
