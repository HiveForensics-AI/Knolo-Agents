import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HarnessError,
  KNOLO_MCP_TOOLS,
  MCP_PROTOCOL_VERSION,
  handleMcpRequest,
  knoloMcpBridge,
} from "../dist/index.js";

const task = {
  objective: "Investigate these transactions for potential fraud.",
  successCriteria: ["identify suspicious transactions", "cite supporting evidence"],
  prohibitedActions: ["wire_transfer"],
};

function ctx(overrides = {}) {
  return {
    runId: "mcp-1",
    task,
    envelope: {
      task,
      evidence: [{ id: "ledger-pack", text: "cite supporting evidence from ledger-pack", sourceId: "ledger-pack" }],
      memories: [],
      skills: [{ id: "ledger-review", text: "Review ledger anomalies in order." }],
      constraints: [],
      capabilities: { version: 1, level: "L1", tools: true, resume: false, observe: false, interrupt: false, limitations: [] },
      budget: { maxSteps: 8 },
      dependencyRoot: "knolo.harness.dependencies.v1:test",
      receipts: [],
    },
    ...overrides,
  };
}

test("MCP initialize and tools/list expose retrieve, skills, and evaluate", async () => {
  const server = knoloMcpBridge({ ctx: ctx() });
  const init = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(init.result.serverInfo.name, "knolo-mcp-bridge");
  const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = listed.result.tools.map(tool => tool.name);
  assert.deepEqual(names, [KNOLO_MCP_TOOLS.retrieve, KNOLO_MCP_TOOLS.resolveSkills, KNOLO_MCP_TOOLS.evaluate]);
  const ping = await server.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(ping, null);
});

test("MCP retrieve and resolve_skills read the compiled envelope", async () => {
  const server = knoloMcpBridge({ ctx: ctx() });
  const retrieved = await server.callTool(KNOLO_MCP_TOOLS.retrieve, { query: "ledger" });
  assert.equal(retrieved.isError, undefined);
  assert.equal(retrieved.structured.evidence[0].sourceId, "ledger-pack");
  const skills = await server.callTool(KNOLO_MCP_TOOLS.resolveSkills, {});
  assert.equal(skills.structured.skills[0].id, "ledger-review");
});

test("MCP evaluate scores proposed output against the frozen task", async () => {
  const server = knoloMcpBridge({ ctx: ctx() });
  const passed = await server.callTool(KNOLO_MCP_TOOLS.evaluate, {
    output: "identify suspicious transactions and cite supporting evidence",
  });
  assert.equal(passed.structured.passed, true);
  assert.equal(passed.structured.successCriteriaMatched.length, 2);
  const denied = await server.callTool(KNOLO_MCP_TOOLS.evaluate, { output: "completed via wire_transfer" });
  assert.equal(denied.structured.passed, false);
  assert.deepEqual(denied.structured.prohibitedViolations, ["wire_transfer"]);
});

test("MCP fails closed on unknown tools, prohibited names, and missing context", async () => {
  const server = knoloMcpBridge({ ctx: ctx() });
  const unknown = await server.callTool("not.a.tool", {});
  assert.equal(unknown.isError, true);
  const prohibited = await server.callTool("wire_transfer", {});
  assert.equal(prohibited.isError, true);
  assert.match(prohibited.content[0].text, /prohibited/);
  const unbound = knoloMcpBridge();
  const missing = await unbound.callTool(KNOLO_MCP_TOOLS.retrieve, { query: "x" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /requires a harness context/);
});

test("MCP resources list and read task, context, and skills", async () => {
  const server = knoloMcpBridge({
    ctx: ctx(),
    resources: { "knolo://custom": { hello: true } },
  });
  const uris = server.listResources().map(item => item.uri);
  assert.equal(uris.includes("knolo://task"), true);
  assert.equal(uris.includes("knolo://custom"), true);
  const taskResource = await server.readResource("knolo://task");
  assert.equal(taskResource.objective, task.objective);
  const custom = await server.readResource("knolo://custom");
  assert.deepEqual(custom, { hello: true });
  await assert.rejects(() => server.readResource("knolo://missing"), HarnessError);
});

test("MCP JSON-RPC rejects unknown methods and extra tools without handlers", async () => {
  const server = knoloMcpBridge({ ctx: ctx() });
  const missing = await handleMcpRequest(server, { jsonrpc: "2.0", id: 9, method: "tools/explode" });
  assert.equal(missing.error.code, -32601);
  const invalid = await handleMcpRequest(server, "not-json");
  assert.equal(invalid.error.code, -32600);
  assert.throws(
    () => knoloMcpBridge({ extraTools: [{ name: "custom.search", description: "x", inputSchema: { type: "object" } }] }),
    /missing a handler/,
  );
});

test("mcp adapter does not import icp", () => {
  const text = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/adapters/mcp.ts"), "utf8");
  assert.equal(/from ["'].*icp/.test(text), false);
  assert.equal(/IcpAgentRuntimeClient/.test(text), false);
});
