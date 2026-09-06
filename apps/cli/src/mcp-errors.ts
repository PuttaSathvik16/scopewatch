export type McpTestErrorCategory = 'spawn_failed' | 'handshake_timeout' | 'malformed_response' | 'protocol_error';

export class McpTestError extends Error {
  category: McpTestErrorCategory;
  detail: string | undefined;

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

export function malformedResponseError(raw: string): McpTestError {
  return new McpTestError(
    'malformed_response',
    `The server responded, but its output was not valid JSON-RPC. This usually means the server printed ` +
      `something to stdout other than protocol messages (e.g. a startup banner or a log line).`,
    raw
  );
}

export function protocolErrorResponse(code: number, message: string): McpTestError {
  return new McpTestError(
    'protocol_error',
    `The server responded with a JSON-RPC error (code ${code}): ${message}`,
    message
  );
}
