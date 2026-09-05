import { loadCoreV5, requireCoreV5 } from "./load.js";

export interface KnowledgeImageHandleV5 {
  readonly stateRoot: string;
  readonly commitDigest: string;
  readonly bytes: Uint8Array;
  readonly image: unknown;
}

type KnowledgeCore = {
  createKnowledgeImageV5: (options: { actor?: string; objects: Array<{ kind: string; bytes: Uint8Array; meta: Record<string, unknown> }> }) => {
    bytes: Uint8Array;
    stateRoot: string;
    commitDigest: string;
  };
  verifyKnowledgeImageV5: (bytes: Uint8Array) => { stateRoot: string; commitDigest: string };
  mountKnowledgeImageV5: (bytes: Uint8Array) => { stateRoot: string; commitDigest: string; bytes: Uint8Array };
  inspectKnowledgeImageV5: (bytes: Uint8Array) => { stateRoot: string; commitDigest: string };
  queryKnowledgeImageV5: (image: unknown, expression: string) => unknown;
};

export class V5KnowledgeAdapter {
  private constructor(private readonly core: KnowledgeCore) {}

  static async create(core?: KnowledgeCore): Promise<V5KnowledgeAdapter> {
    return new V5KnowledgeAdapter(core ?? ((await loadCoreV5()) as unknown as KnowledgeCore));
  }

  static from(core: KnowledgeCore | null | undefined): V5KnowledgeAdapter {
    return new V5KnowledgeAdapter(requireCoreV5(core) as KnowledgeCore);
  }

  createImage(objects: Array<{ kind: string; bytes: Uint8Array; meta?: Record<string, unknown> }>, actor = "agents"): KnowledgeImageHandleV5 {
    const created = this.core.createKnowledgeImageV5({
      actor,
      objects: objects.map(object => ({ kind: object.kind, bytes: object.bytes, meta: object.meta ?? {} })),
    });
    return this.mount(created.bytes);
  }

  verify(bytes: Uint8Array): { readonly stateRoot: string; readonly commitDigest: string } {
    return this.core.verifyKnowledgeImageV5(bytes);
  }

  mount(bytes: Uint8Array): KnowledgeImageHandleV5 {
    const verified = this.core.verifyKnowledgeImageV5(bytes);
    const image = this.core.mountKnowledgeImageV5(bytes);
    return { stateRoot: verified.stateRoot, commitDigest: verified.commitDigest, bytes, image };
  }

  inspect(bytes: Uint8Array): { readonly stateRoot: string; readonly commitDigest: string } {
    return this.core.inspectKnowledgeImageV5(bytes);
  }

  query(handle: KnowledgeImageHandleV5, expression: string): unknown {
    return this.core.queryKnowledgeImageV5(handle.image, expression);
  }

  objects(handle: KnowledgeImageHandleV5): Array<{ id: string; kind: string; text: string; meta: Record<string, unknown> }> {
    const image = handle.image as { objects?: Array<{ id: string; kind: string; bytes: Uint8Array; meta?: Record<string, unknown> }> };
    const decode = new TextDecoder();
    return (image.objects ?? []).map(object => ({
      id: object.id,
      kind: object.kind,
      text: decode.decode(object.bytes),
      meta: object.meta ?? {},
    }));
  }
}
