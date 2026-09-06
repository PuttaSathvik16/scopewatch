/** A tool as returned by a real MCP server's tools/list response. */
export type McpTool = {
  name: string;
  description: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; description?: string }>;
  };
  /** Optional per the MCP spec - self-reported by the server author, not independently verified. */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type InferredCapability = {
  tool_id: string;
  verb: 'read' | 'fetch' | 'send' | 'write' | 'delete' | 'execute';
  resource: string;
  provenance: 'inferred';
  description: string;
};

export type InferenceResult = {
  capabilities: InferredCapability[];
  /** Non-fatal signals worth surfacing in diagnostics - contradictory self-reported
   * annotations, or cases where keyword evidence overrode a declared hint. */
  warnings: string[];
};
