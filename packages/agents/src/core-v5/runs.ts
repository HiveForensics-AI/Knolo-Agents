import { loadCoreV5, requireCoreV5 } from "./load.js";

type RunCore = {
  createKnowledgeRunV1: (options: { agentId: string; imageStateRoot: string; input: Record<string, unknown>; createdAt: number }) => unknown;
  startKnowledgeRunV1: (run: unknown, at: number) => unknown;
  checkpointKnowledgeRunV1: (run: unknown, state: Record<string, unknown>, at: number) => unknown;
  completeKnowledgeRunV1: (run: unknown, result: Record<string, unknown>, at: number) => unknown;
  failKnowledgeRunV1: (run: unknown, error: string, at: number) => unknown;
};

export class V5RunAdapter {
  private constructor(private readonly core: RunCore) {}

  static async create(core?: RunCore): Promise<V5RunAdapter> {
    return new V5RunAdapter(core ?? ((await loadCoreV5()) as unknown as RunCore));
  }

  static from(core: RunCore | null | undefined): V5RunAdapter {
    return new V5RunAdapter(requireCoreV5(core));
  }

  start(options: { agentId: string; imageStateRoot: string; input?: Record<string, unknown>; now?: number }): unknown {
    const at = options.now ?? 0;
    const created = this.core.createKnowledgeRunV1({
      agentId: options.agentId,
      imageStateRoot: options.imageStateRoot,
      input: options.input ?? {},
      createdAt: at,
    });
    return this.core.startKnowledgeRunV1(created, at);
  }

  checkpoint(run: unknown, state: Record<string, unknown>, now = 0): unknown {
    return this.core.checkpointKnowledgeRunV1(run, state, now);
  }

  complete(run: unknown, result: Record<string, unknown> = {}, now = 0): unknown {
    return this.core.completeKnowledgeRunV1(run, result, now);
  }

  fail(run: unknown, error: string, now = 0): unknown {
    return this.core.failKnowledgeRunV1(run, error, now);
  }
}
