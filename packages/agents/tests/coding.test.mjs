import assert from "node:assert/strict";
import test from "node:test";
import { runLocalCoding } from "../dist/index.js";

function host(counters) {
  return {
    inspect: async () => {
      counters.inspect += 1;
      return { files: ["src/main.ts"] };
    },
    applyEdit: async () => {
      counters.edit += 1;
      return {
        version: 1,
        call_id: "coding-edit-1",
        tool_id: "workspace-write",
        host: "fixture-host",
        idempotency_key: "coding-edit-1",
        status: "executed",
        redacted_output: null,
        resource_delta: { calls: 1, units: 1, duration_ms: 1 },
        retry_class: "non_idempotent",
      };
    },
    runTests: async () => {
      counters.tests += 1;
      return { passed: true, summary: "fixture tests passed" };
    },
  };
}

test("coding slice uses inspection, approved edit, tests, and receipt", async () => {
  const counters = { inspect: 0, edit: 0, tests: 0 };
  const result = await runLocalCoding({ task: "update the fixture", approval: "approved", host: host(counters), executionId: "coding-fixture" });
  assert.equal(result.report.status.type, "terminated");
  assert.deepEqual(result.report.status.result, {
    version: 1,
    task: "update the fixture",
    changed: true,
    tests_passed: true,
    edit_receipt_id: "coding-edit-1",
    test_summary: "fixture tests passed",
  });
  assert.deepEqual(counters, { inspect: 1, edit: 1, tests: 1 });
});

test("coding slice suspends before an unapproved edit", async () => {
  const counters = { inspect: 0, edit: 0, tests: 0 };
  const result = await runLocalCoding({ task: "update the fixture", approval: "denied", host: host(counters) });
  assert.deepEqual(result.report.status, { type: "suspended", reason: "edit-approval-required" });
  assert.deepEqual(counters, { inspect: 1, edit: 0, tests: 0 });
});
