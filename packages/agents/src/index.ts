/** Public TypeScript surface for Knolo agents. */
export type AgentId = string & { readonly __brand: "AgentId" };

export interface ToolCallV1 { readonly version: 1; readonly call_id: string; readonly tool_id: string; readonly arguments: unknown }
export interface ToolResultV1 { readonly version: 1; readonly call_id: string; readonly tool_id: string; readonly value: unknown; readonly usage: ResourceUsageV1 }
export interface ResourceUsageV1 { readonly calls: number; readonly units: number; readonly duration_ms: number }
export interface RetrievalEvidenceV1 { readonly content: unknown; readonly score_micros: number; readonly provenance: { readonly source_id: string; readonly locator: string; readonly content_hash: string } }
export interface RetrievalResultV1 { readonly version: 1; readonly evidence: readonly RetrievalEvidenceV1[] }
