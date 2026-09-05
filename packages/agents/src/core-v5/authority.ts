import { loadCoreV5, requireCoreV5 } from "./load.js";

type AuthorityCore = {
  verifyKnowledgeAuthorityEnvelopeV5: (...args: unknown[]) => unknown;
};

/** Thin pass-through. Agents does not reimplement Core authority envelopes. */
export class V5AuthorityAdapter {
  private constructor(private readonly core: AuthorityCore) {}

  static async create(core?: AuthorityCore): Promise<V5AuthorityAdapter> {
    return new V5AuthorityAdapter(core ?? ((await loadCoreV5()) as unknown as AuthorityCore));
  }

  static from(core: AuthorityCore | null | undefined): V5AuthorityAdapter {
    return new V5AuthorityAdapter(requireCoreV5(core));
  }

  verify(...args: unknown[]): unknown {
    return this.core.verifyKnowledgeAuthorityEnvelopeV5(...args);
  }
}
