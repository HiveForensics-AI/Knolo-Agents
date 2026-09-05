import type { JsonValue } from "../contracts/index.js";
import type { ClaimGraphCapability, ClaimProposalV1 } from "../claims/index.js";
import { loadCoreV5, requireCoreV5 } from "./load.js";

type ClaimGraph = { version: 1; nodes: unknown[]; edges: unknown[] };
type ClaimCore = {
  getClaimGraph: (pack: unknown) => ClaimGraph | null;
  buildClaimGraph: (docs: Array<{ id?: string; heading?: string; text: string }>) => ClaimGraph;
};

/** Maps Core ClaimGraph helpers onto the legacy `ClaimGraphCapability` interface. */
export class V5ClaimGraphAdapter implements ClaimGraphCapability<JsonValue, JsonValue> {
  private graph: ClaimGraph;

  private constructor(private readonly core: ClaimCore, graph?: ClaimGraph) {
    this.graph = graph ?? { version: 1, nodes: [], edges: [] };
  }

  static async create(core?: ClaimCore): Promise<V5ClaimGraphAdapter> {
    return new V5ClaimGraphAdapter(core ?? ((await loadCoreV5()) as unknown as ClaimCore));
  }

  static from(core: ClaimCore | null | undefined, graph?: ClaimGraph): V5ClaimGraphAdapter {
    return new V5ClaimGraphAdapter(requireCoreV5(core), graph);
  }

  fromPack(pack: unknown): this {
    this.graph = this.core.getClaimGraph(pack) ?? { version: 1, nodes: [], edges: [] };
    return this;
  }

  fromDocuments(docs: Array<{ id?: string; heading?: string; text: string }>): this {
    this.graph = this.core.buildClaimGraph(docs);
    return this;
  }

  async read(query: JsonValue): Promise<JsonValue> {
    const needle = typeof query === "string" ? query : JSON.stringify(query);
    if (!needle || needle === "{}") return this.graph as unknown as JsonValue;
    const nodes = this.graph.nodes.filter(node => JSON.stringify(node).toLowerCase().includes(needle.toLowerCase()));
    const edges = this.graph.edges.filter(edge => JSON.stringify(edge).toLowerCase().includes(needle.toLowerCase()));
    return { version: 1, nodes, edges } as unknown as JsonValue;
  }

  async commit(proposal: ClaimProposalV1): Promise<JsonValue> {
    this.graph = {
      version: 1,
      nodes: [...this.graph.nodes, { id: `proposal:${this.graph.nodes.length + 1}`, label: proposal.justification, props: { operation: JSON.stringify(proposal.operation) } }],
      edges: this.graph.edges,
    };
    return this.graph as unknown as JsonValue;
  }
}

export class LegacyClaimGraphAdapter<Q extends JsonValue = JsonValue, R extends JsonValue = JsonValue> implements ClaimGraphCapability<Q, R> {
  constructor(private readonly inner: ClaimGraphCapability<Q, R>) {}
  read(query: Q): Promise<R> {
    return this.inner.read(query);
  }
  commit(proposal: ClaimProposalV1): Promise<R> {
    return this.inner.commit(proposal);
  }
}
