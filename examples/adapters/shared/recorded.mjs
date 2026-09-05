import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "./contracts.mjs";

export function loadVendorFixture(name) {
  return JSON.parse(readFileSync(resolve(repoRoot(), "contracts/fixtures/harness/vendors", name), "utf8"));
}

export function recordedComplete(turns) {
  let index = 0;
  return async () => {
    const turn = turns[Math.min(index, turns.length - 1)];
    index += 1;
    return turn;
  };
}
