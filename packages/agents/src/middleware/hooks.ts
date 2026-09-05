export const MIDDLEWARE_HOOK_ORDER = [
  "beforeRun",
  "beforeContext",
  "onEvidence",
  "onSkillCandidates",
  "onSkillSelected",
  "beforeAgent",
  "beforeTool",
  "afterTool",
  "onCheckpoint",
  "onError",
  "onRecovery",
  "beforeComplete",
  "afterComplete",
] as const;

export type MiddlewareHookName = (typeof MIDDLEWARE_HOOK_ORDER)[number];
