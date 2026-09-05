import type { JsonValue } from "../contracts/index.js";
import { evaluateInvocation } from "../harness/lifecycle.js";
import { stringifyOutput } from "../harness/task.js";
import { HarnessError, type HarnessContextV1, type InvocationStatusV1 } from "../harness/types.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export const KNOLO_MCP_TOOLS = {
  retrieve: "knolo.retrieve",
  resolveSkills: "knolo.resolve_skills",
  evaluate: "knolo.evaluate",
} as const;

export interface McpToolDefinitionV1 {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
}

export interface McpResourceV1 {
  readonly uri: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly description?: string;
}

export interface McpToolCallResultV1 {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError?: boolean;
  readonly structured?: JsonValue;
}

export type McpToolHandler = (args: JsonValue, ctx?: HarnessContextV1) => JsonValue | Promise<JsonValue>;

export interface McpJsonRpcRequest {
  readonly jsonrpc?: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: JsonValue;
}

export interface McpJsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result: JsonValue;
}

export interface McpJsonRpcError {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: JsonValue };
}

export type McpJsonRpcResponse = McpJsonRpcSuccess | McpJsonRpcError;

export interface McpToolServer {
  listTools(): readonly McpToolDefinitionV1[];
  callTool(name: string, args?: JsonValue, ctx?: HarnessContextV1): Promise<McpToolCallResultV1>;
  listResources(): readonly McpResourceV1[];
  readResource(uri: string): Promise<JsonValue>;
  handle(request: McpJsonRpcRequest | string): Promise<McpJsonRpcResponse | null>;
}

export interface KnoloMcpBridgeOptions {
  readonly ctx?: HarnessContextV1;
  readonly retrieve?: McpToolHandler;
  readonly resolveSkills?: McpToolHandler;
  readonly evaluate?: McpToolHandler;
  readonly resources?: Readonly<Record<string, JsonValue | (() => JsonValue | Promise<JsonValue>)>>;
  readonly extraTools?: readonly McpToolDefinitionV1[];
  readonly extraHandlers?: Readonly<Record<string, McpToolHandler>>;
  readonly serverName?: string;
  readonly serverVersion?: string;
}

const RETRIEVE_SCHEMA: JsonValue = {
  type: "object",
  properties: { query: { type: "string", description: "Lexical query over compiled evidence" } },
};

const SKILLS_SCHEMA: JsonValue = {
  type: "object",
  properties: { query: { type: "string", description: "Optional filter over selected skills" } },
};

const EVALUATE_SCHEMA: JsonValue = {
  type: "object",
  required: ["output"],
  properties: {
    output: { description: "Proposed agent output to score against the frozen task" },
    status: { type: "string", enum: ["succeeded", "partial", "failed", "suspended"] },
    toolCalls: { type: "array", items: { type: "string" } },
  },
};

/** Generic MCP tool/resource surface. Vendor SDKs stay in examples. */
export function knoloMcpBridge(options: KnoloMcpBridgeOptions = {}): McpToolServer {
  const tools = new Map<string, { definition: McpToolDefinitionV1; handler: McpToolHandler }>();
  register(tools, KNOLO_MCP_TOOLS.retrieve, "Retrieve compiled Knolo evidence for the current task.", RETRIEVE_SCHEMA, options.retrieve ?? defaultRetrieve);
  register(tools, KNOLO_MCP_TOOLS.resolveSkills, "Return selected Knolo skills for the current task.", SKILLS_SCHEMA, options.resolveSkills ?? defaultResolveSkills);
  register(tools, KNOLO_MCP_TOOLS.evaluate, "Run deterministic Knolo evaluation against a proposed output.", EVALUATE_SCHEMA, options.evaluate ?? defaultEvaluate);
  for (const extra of options.extraTools ?? []) {
    const handler = options.extraHandlers?.[extra.name];
    if (!handler) throw new HarnessError(`mcp extra tool is missing a handler: ${extra.name}`);
    if (tools.has(extra.name)) throw new HarnessError(`mcp tool is already registered: ${extra.name}`);
    tools.set(extra.name, { definition: extra, handler });
  }
  for (const [name, handler] of Object.entries(options.extraHandlers ?? {})) {
    if (tools.has(name)) continue;
    throw new HarnessError(`mcp extra handler has no tool definition: ${name}`);
  }

  const resourceReaders = new Map<string, () => JsonValue | Promise<JsonValue>>();
  resourceReaders.set("knolo://task", () => json(options.ctx?.task ?? null));
  resourceReaders.set("knolo://context", () => json(options.ctx?.envelope ?? null));
  resourceReaders.set("knolo://skills", () => json(options.ctx?.envelope.skills ?? []));
  for (const [uri, value] of Object.entries(options.resources ?? {})) {
    resourceReaders.set(uri, typeof value === "function" ? value : () => value);
  }

  const resources: McpResourceV1[] = [...resourceReaders.keys()].sort().map(uri => ({
    uri,
    name: uri.replace(/^knolo:\/\//, ""),
    mimeType: "application/json",
  }));

  const server: McpToolServer = {
    listTools: () => [...tools.values()].map(item => item.definition),
    async callTool(name, args = null, ctx) {
      const bound = ctx ?? options.ctx;
      const prohibited = bound?.task.prohibitedActions ?? [];
      if (prohibited.includes(name)) {
        return errorResult(`tool is prohibited by task policy: ${name}`);
      }
      const tool = tools.get(name);
      if (!tool) return errorResult(`unknown mcp tool: ${name}`);
      try {
        const structured = json(await tool.handler(args ?? null, bound));
        return { content: [{ type: "text", text: stringifyOutput(structured) }], structured };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
    listResources: () => resources,
    async readResource(uri) {
      const reader = resourceReaders.get(uri);
      if (!reader) throw new HarnessError(`unknown mcp resource: ${uri}`);
      return json(await reader());
    },
    async handle(request) {
      return handleMcpRequest(server, request, {
        name: options.serverName ?? "knolo-mcp-bridge",
        version: options.serverVersion ?? "1",
      });
    },
  };
  return server;
}

export async function handleMcpRequest(
  server: McpToolServer,
  request: McpJsonRpcRequest | string,
  info: { name: string; version: string } = { name: "knolo-mcp-bridge", version: "1" },
): Promise<McpJsonRpcResponse | null> {
  const parsed = parseRequest(request);
  if (!parsed.ok) return rpcError(null, -32600, parsed.error);
  const { id, method, params } = parsed.value;
  const notification = id === undefined;
  try {
    const result = await dispatch(server, method, params, info);
    if (notification) return null;
    return { jsonrpc: "2.0", id: id ?? null, result };
  } catch (error) {
    if (notification) return null;
    const message = error instanceof Error ? error.message : String(error);
    const code = message.startsWith("method not found") ? -32601 : message.startsWith("invalid params") ? -32602 : -32603;
    return rpcError(id ?? null, code, message);
  }
}

async function dispatch(
  server: McpToolServer,
  method: string,
  params: JsonValue | undefined,
  info: { name: string; version: string },
): Promise<JsonValue> {
  if (method === "initialize") {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
      serverInfo: { name: info.name, version: info.version },
    };
  }
  if (method === "notifications/initialized" || method === "ping") return {};
  if (method === "tools/list") return { tools: server.listTools() as unknown as JsonValue };
  if (method === "tools/call") {
    const name = record(params).name;
    if (typeof name !== "string" || !name) throw new HarnessError("invalid params: tools/call requires name");
    const args = "arguments" in record(params) ? (record(params).arguments as JsonValue) : null;
    const result = await server.callTool(name, args);
    return result as unknown as JsonValue;
  }
  if (method === "resources/list") return { resources: server.listResources() as unknown as JsonValue };
  if (method === "resources/read") {
    const uri = record(params).uri;
    if (typeof uri !== "string" || !uri) throw new HarnessError("invalid params: resources/read requires uri");
    const contents = await server.readResource(uri);
    return { contents: [{ uri, mimeType: "application/json", text: stringifyOutput(contents) }] };
  }
  throw new HarnessError(`method not found: ${method}`);
}

function defaultRetrieve(args: JsonValue, ctx?: HarnessContextV1): JsonValue {
  if (!ctx) throw new HarnessError("knolo.retrieve requires a harness context");
  const query = typeof record(args).query === "string" ? String(record(args).query) : ctx.task.objective;
  const needle = query.toLowerCase();
  const evidence = ctx.envelope.evidence.filter(item => stringifyOutput(item).toLowerCase().includes(needle));
  return { query, evidence: evidence.length ? evidence : ctx.envelope.evidence };
}

function defaultResolveSkills(args: JsonValue, ctx?: HarnessContextV1): JsonValue {
  if (!ctx) throw new HarnessError("knolo.resolve_skills requires a harness context");
  const query = typeof record(args).query === "string" ? String(record(args).query).toLowerCase() : "";
  const skills = query
    ? ctx.envelope.skills.filter(item => stringifyOutput(item).toLowerCase().includes(query))
    : ctx.envelope.skills;
  return { skills };
}

function defaultEvaluate(args: JsonValue, ctx?: HarnessContextV1): JsonValue {
  if (!ctx) throw new HarnessError("knolo.evaluate requires a harness context");
  const body = record(args);
  if (!("output" in body)) throw new HarnessError("invalid params: knolo.evaluate requires output");
  const status = parseStatus(body.status);
  const toolCalls = Array.isArray(body.toolCalls) ? body.toolCalls.map(item => String(item)) : [];
  const receipt = evaluateInvocation(ctx.task, status, body.output, toolCalls);
  return receipt as unknown as JsonValue;
}

function register(
  tools: Map<string, { definition: McpToolDefinitionV1; handler: McpToolHandler }>,
  name: string,
  description: string,
  inputSchema: JsonValue,
  handler: McpToolHandler,
): void {
  tools.set(name, { definition: { name, description, inputSchema }, handler });
}

function parseRequest(request: McpJsonRpcRequest | string): { ok: true; value: McpJsonRpcRequest } | { ok: false; error: string } {
  try {
    const value = typeof request === "string" ? (JSON.parse(request) as McpJsonRpcRequest) : request;
    if (!value || typeof value !== "object" || typeof value.method !== "string") return { ok: false, error: "invalid request" };
    return { ok: true, value };
  } catch {
    return { ok: false, error: "invalid request" };
  }
}

function rpcError(id: string | number | null, code: number, message: string): McpJsonRpcError {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function errorResult(message: string): McpToolCallResultV1 {
  return { content: [{ type: "text", text: message }], isError: true, structured: { error: message } };
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, JsonValue>;
}

function parseStatus(value: JsonValue | undefined): InvocationStatusV1 {
  if (value === "succeeded" || value === "partial" || value === "failed" || value === "suspended") return value;
  return "succeeded";
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
