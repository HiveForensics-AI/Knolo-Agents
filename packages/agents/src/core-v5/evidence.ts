import { loadCoreV5, requireCoreV5 } from "./load.js";

type EvidenceCore = {
  queryWithReceipt: (pack: unknown, query: string, options?: Record<string, unknown>) => { hits: unknown; receipt: unknown };
  verifyReceipt: (receipt: unknown, pack: unknown) => void;
};

export class V5EvidenceAdapter {
  private constructor(private readonly core: EvidenceCore) {}

  static async create(core?: EvidenceCore): Promise<V5EvidenceAdapter> {
    return new V5EvidenceAdapter(core ?? ((await loadCoreV5()) as unknown as EvidenceCore));
  }

  static from(core: EvidenceCore | null | undefined): V5EvidenceAdapter {
    return new V5EvidenceAdapter(requireCoreV5(core));
  }

  queryWithReceipt(pack: unknown, query: string, options?: Record<string, unknown>): { hits: unknown; receipt: unknown } {
    return this.core.queryWithReceipt(pack, query, options);
  }

  verifyReceipt(receipt: unknown, pack: unknown): void {
    this.core.verifyReceipt(receipt, pack);
  }
}
