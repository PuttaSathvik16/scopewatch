export type McpTestErrorCategory =
  | 'spawn_failed'
  | 'handshake_timeout'
  | 'malformed_response'
  | 'initialize_rejected'
  | 'tools_list_failed'
  | 'protocol_error';

export class McpTestError extends Error {
  category: McpTestErrorCategory;
  detail: string | undefined;
  /** Redacted stderr captured from the real spawned process, when available - see attachStderrContext. */
  stderrContext: string | undefined;

  constructor(category: McpTestErrorCategory, message: string, detail?: string) {
    super(message);
    this.name = 'McpTestError';
    this.category = category;
    this.detail = detail;
  }
}

export function spawnFailedError(command: string, detail: string): McpTestError {
  return new McpTestError(
    'spawn_failed',
    `Failed to start the server process ('${command}'): ${detail}. Check that the package installed correctly.`,
    detail
  );
}

export function handshakeTimeoutError(timeoutMs: number): McpTestError {
  return new McpTestError(
    'handshake_timeout',
    `The server did not respond to the MCP handshake within ${timeoutMs}ms. It may have crashed on startup, ` +
      `be waiting on missing configuration, or not implement the MCP protocol correctly.`
  );
}

/**
 * Covers BOTH a JSON-parsing failure (the server printed non-JSON-RPC to
 * stdout - a banner, a log line) AND a validly-parsed JSON-RPC success
 * response whose result doesn't actually match the shape the called method
 * is supposed to return (e.g. tools/list's result.tools isn't an array).
 * These are the same underlying situation from the caller's point of view -
 * "the response doesn't look like a valid response for this call" - not two
 * different failure modes, so they share one category rather than splitting
 * into a fifth.
 */
export function malformedResponseError(raw: string): McpTestError {
  return new McpTestError(
    'malformed_response',
    `The server responded, but its output was not a valid response for this call. This usually means the ` +
      `server printed something to stdout other than protocol messages (e.g. a startup banner or a log line), ` +
      `or returned a result in an unexpected shape.`,
    raw
  );
}

/** The server rejected the initialize handshake itself (protocol version mismatch, capability negotiation failure). */
export function initializeRejectedError(code: number, message: string): McpTestError {
  return new McpTestError(
    'initialize_rejected',
    `The server rejected the MCP handshake itself (code ${code}): ${message}. This usually means a protocol ` +
      `version mismatch or a capability negotiation failure - the server started, but refuses to talk to this client at all.`,
    message
  );
}

/** initialize succeeded, but the server couldn't/wouldn't enumerate its tools. */
export function toolsListFailedError(code: number, message: string): McpTestError {
  return new McpTestError(
    'tools_list_failed',
    `The server completed the handshake but failed to list its tools (code ${code}): ${message}. This often ` +
      `means the server started but is missing required runtime configuration.`,
    message
  );
}

/** Fallback for a JSON-RPC error at a stage that doesn't map to initialize or tools/list specifically. */
export function protocolErrorResponse(code: number, message: string): McpTestError {
  return new McpTestError('protocol_error', `The server responded with a JSON-RPC error (code ${code}): ${message}`, message);
}

/**
 * Attaches REDACTED stderr context to an already-constructed error, and
 * folds it into the visible message - not just into `.detail`, so it's seen
 * even by a caller that only prints `.message`. `redactedStderr` must
 * already have been passed through @scopewatch/secrets' redact() by the
 * caller BEFORE reaching this function - this function does not redact
 * anything itself, to keep the redaction call site explicit and singular
 * (see mcp-client.ts).
 */
export function attachStderrContext(error: McpTestError, redactedStderr: string): McpTestError {
  if (!redactedStderr.trim()) return error;
  error.stderrContext = redactedStderr;
  error.message = `${error.message}\n\nServer stderr output:\n${redactedStderr.trim()}`;
  return error;
}
