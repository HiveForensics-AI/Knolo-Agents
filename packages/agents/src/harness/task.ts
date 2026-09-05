import { HarnessError, type TaskV1 } from "./types.js";

const identifier = /^[A-Za-z0-9_.\/-]{1,128}$/;

export function validateTask(task: TaskV1): TaskV1 {
  if (!task || typeof task !== "object") throw new HarnessError("task is required");
  if (typeof task.objective !== "string" || !task.objective.trim()) throw new HarnessError("task.objective must be a non-empty string");
  if (!Array.isArray(task.successCriteria) || task.successCriteria.length === 0) throw new HarnessError("task.successCriteria must contain at least one criterion");
  if (task.successCriteria.some(item => typeof item !== "string" || !item.trim())) throw new HarnessError("task.successCriteria must be non-empty strings");
  if (task.id !== undefined && !identifier.test(task.id)) throw new HarnessError(`task.id is not a valid identifier: ${task.id}`);
  if (task.budget) {
    for (const [key, value] of Object.entries(task.budget)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new HarnessError(`task.budget.${key} must be a positive integer`);
    }
  }
  return task;
}

export function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}
