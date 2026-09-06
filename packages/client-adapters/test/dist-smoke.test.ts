import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { join } from 'node:path';
// Imported BY PACKAGE NAME to force real dist/ resolution.
import { configPathFor, CLAUDE_CODE_CLIENT_ID, CURSOR_CLIENT_ID } from '@scopewatch/client-adapters';

test('dist smoke: @scopewatch/client-adapters resolves config paths through compiled output', () => {
  // join(), not hardcoded POSIX separators: found via a real Windows CI run
  // that configPathFor correctly returns native separators per platform.
  strictEqual(configPathFor(CLAUDE_CODE_CLIENT_ID, '/proj'), join('/proj', '.mcp.json'));
  strictEqual(configPathFor(CURSOR_CLIENT_ID, '/proj'), join('/proj', '.cursor', 'mcp.json'));
});
