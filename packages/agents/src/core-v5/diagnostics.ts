import { loadCoreV5, requireCoreV5 } from "./load.js";

type DiagnosticsCore = {
  inspectKnowledgeRuntimeV5: (input: { image: unknown }) => unknown;
  canonicalCbor: (value: unknown) => Uint8Array;
  digestBytes: (bytes: Uint8Array) => string;
};

export class V5DiagnosticsAdapter {
  private constructor(private readonly core: DiagnosticsCore) {}

  static async create(core?: DiagnosticsCore): Promise<V5DiagnosticsAdapter> {
    return new V5DiagnosticsAdapter(core ?? ((await loadCoreV5()) as unknown as DiagnosticsCore));
  }

  static from(core: DiagnosticsCore | null | undefined): V5DiagnosticsAdapter {
    return new V5DiagnosticsAdapter(requireCoreV5(core));
  }

  inspect(image: unknown): unknown {
    return this.core.inspectKnowledgeRuntimeV5({ image });
  }

  canonicalCbor(value: unknown): Uint8Array {
    return this.core.canonicalCbor(value);
  }

  digestBytes(bytes: Uint8Array): string {
    return this.core.digestBytes(bytes);
  }
}
