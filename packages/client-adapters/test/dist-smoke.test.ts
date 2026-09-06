import { test } from 'node:test';
import { strictEqual } from 'node:assert';
// Imported BY PACKAGE NAME to force real dist/ resolution.
import { configPathFor, CLAUDE_CODE_CLIENT_ID, CURSOR_CLIENT_ID } from '@scopewatch/client-adapters';

test('dist smoke: @scopewatch/client-adapters resolves config paths through compiled output', () => {
  strictEqual(configPathFor(CLAUDE_CODE_CLIENT_ID, '/proj'), '/proj/.mcp.json');
  strictEqual(configPathFor(CURSOR_CLIENT_ID, '/proj'), '/proj/.cursor/mcp.json');
});
