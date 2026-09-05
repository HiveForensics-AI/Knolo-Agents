import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateTask } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemas = resolve(root, "contracts/schemas");
const fixtures = resolve(root, "contracts/fixtures/harness");

const pairs = [
  ["task-dummy-v1.json", "task-v1.schema.json"],
  ["dependency-root-v1.json", "harness-dependency-root-v1.schema.json"],
  ["run-receipt-v1.json", "harness-run-receipt-v1.schema.json"],
  ["registry/manifest-v1.json", "pack-manifest-v1.schema.json"],
  ["registry/knolo.lock.json", "knolo-lockfile-v1.schema.json"],
  ["acs/harness-report-v1.json", "acs-harness-report-v1.schema.json"],
];

const replayPairs = [["replay/portable-counter-trace-v1.json", "replay-trace-v1.schema.json"]];

test("harness fixtures validate against published schemas", () => {
  for (const [fixture, schema] of pairs) {
    validateJsonSchema(loadJson(resolve(schemas, schema)), loadJson(resolve(fixtures, fixture)), schemas, fixture);
  }
  for (const [fixture, schema] of replayPairs) {
    validateJsonSchema(loadJson(resolve(schemas, schema)), loadJson(resolve(root, "contracts/fixtures", fixture)), schemas, fixture);
  }
  for (const name of readdirSync(resolve(fixtures, "acs")).filter(item => item.endsWith(".json") && item !== "baseline-report-v1.json" && item !== "harness-report-v1.json")) {
    validateJsonSchema(
      loadJson(resolve(schemas, "acs-suite-v1.schema.json")),
      loadJson(resolve(fixtures, "acs", name)),
      schemas,
      `acs/${name}`,
    );
  }
});

test("dummy task fixture is accepted by validateTask", () => {
  const task = loadJson(resolve(fixtures, "task-dummy-v1.json"));
  assert.equal(validateTask(task).id, "dummy-investigate");
});

test("schema validation fails closed on missing required fields", () => {
  assert.throws(
    () => validateJsonSchema(loadJson(resolve(schemas, "task-v1.schema.json")), { objective: "x" }, schemas, "bad-task"),
    /successCriteria/,
  );
});

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateJsonSchema(schema, value, schemaDir, label) {
  const resolved = resolveSchema(schema, schemaDir);
  const errors = [];
  check(resolved, value, "", errors, schemaDir);
  assert.equal(errors.length, 0, `${label}: ${errors.join("; ")}`);
}

function resolveSchema(schema, schemaDir) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    return resolveSchema(loadJson(resolve(schemaDir, name)), schemaDir);
  }
  return schema;
}

function check(schema, value, path, errors, schemaDir) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path || "/"} is rejected`);
    return;
  }
  const current = resolveSchema(schema, schemaDir);
  if (!current || typeof current !== "object") return;
  const types = current.type === undefined ? null : Array.isArray(current.type) ? current.type : [current.type];
  if (types) {
    const actual = jsonType(value);
    if (!types.includes(actual) && !(types.includes("integer") && actual === "number" && Number.isInteger(value))) {
      errors.push(`${path || "/"} expected ${types.join("|")}, got ${actual}`);
      return;
    }
  }
  if (Object.prototype.hasOwnProperty.call(current, "const") && value !== current.const) {
    errors.push(`${path || "/"} expected const ${JSON.stringify(current.const)}`);
  }
  if (current.enum && !current.enum.includes(value)) {
    errors.push(`${path || "/"} expected one of ${current.enum.join(", ")}`);
  }
  if (typeof value === "string") {
    if (current.minLength && value.length < current.minLength) errors.push(`${path} shorter than minLength`);
    if (current.maxLength && value.length > current.maxLength) errors.push(`${path} longer than maxLength`);
    if (current.pattern && !new RegExp(current.pattern).test(value)) errors.push(`${path} failed pattern ${current.pattern}`);
  }
  if (typeof value === "number") {
    if (current.type === "integer" && !Number.isInteger(value)) errors.push(`${path} is not an integer`);
    if (current.minimum !== undefined && value < current.minimum) errors.push(`${path} below minimum`);
  }
  if (Array.isArray(value)) {
    if (current.minItems && value.length < current.minItems) errors.push(`${path} has fewer than minItems`);
    if (current.items) value.forEach((item, index) => check(current.items, item, `${path}[${index}]`, errors, schemaDir));
  }
  if (value && typeof value === "object" && !Array.isArray(value) && (types === null || types.includes("object"))) {
    for (const key of current.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path || "/"} missing required ${key}`);
    }
    const properties = current.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) check(properties[key], child, path ? `${path}.${key}` : key, errors, schemaDir);
      else if (current.additionalProperties === false) errors.push(`${path || "/"} unexpected property ${key}`);
      else if (current.additionalProperties && current.additionalProperties !== true) {
        check(current.additionalProperties, child, path ? `${path}.${key}` : key, errors, schemaDir);
      }
    }
  }
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
