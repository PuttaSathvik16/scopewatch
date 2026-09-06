import { test } from 'node:test';
import { strictEqual, ok, throws, deepStrictEqual } from 'node:assert';
import { mergeConfig } from '../src/config-writer.js';

test('mergeConfig: writes a new entry into an empty file', () => {
  const result = mergeConfig(null, new Set(['my-server']), {
    'my-server': { command: 'scopewatch-run', args: ['my-server', 'claude-code'] },
  });

  const parsed = JSON.parse(result);
  deepStrictEqual(parsed.mcpServers['my-server'], { command: 'scopewatch-run', args: ['my-server', 'claude-code'] });
});

test('mergeConfig: preserves a human-authored entry Scopewatch does not own', () => {
  const existing = JSON.stringify({
    mcpServers: {
      'human-added-server': { command: 'node', args: ['/path/to/their/server.js'] },
    },
  });

  const result = mergeConfig(existing, new Set(['my-server']), {
    'my-server': { command: 'scopewatch-run', args: ['my-server', 'claude-code'] },
  });

  const parsed = JSON.parse(result);
  deepStrictEqual(
    parsed.mcpServers['human-added-server'],
    { command: 'node', args: ['/path/to/their/server.js'] },
    'the human-authored entry must survive completely unchanged'
  );
  ok(parsed.mcpServers['my-server'], 'the new Scopewatch-owned entry should also be present');
});

test('mergeConfig: preserves unrelated top-level keys in the file', () => {
  const existing = JSON.stringify({
    mcpServers: {},
    someOtherClientSetting: { nested: 'value', keepThis: true },
  });

  const result = mergeConfig(existing, new Set(['my-server']), {
    'my-server': { command: 'scopewatch-run', args: ['my-server', 'claude-code'] },
  });

  const parsed = JSON.parse(result);
  deepStrictEqual(parsed.someOtherClientSetting, { nested: 'value', keepThis: true });
});

test('mergeConfig: removing a key (deactivation) only removes that key, nothing else', () => {
  const existing = JSON.stringify({
    mcpServers: {
      'my-server': { command: 'scopewatch-run', args: ['my-server', 'claude-code'] },
      'other-owned-server': { command: 'scopewatch-run', args: ['other-owned-server', 'claude-code'] },
      'human-server': { command: 'node', args: ['x.js'] },
    },
  });

  const result = mergeConfig(existing, new Set(['my-server', 'other-owned-server']), { 'my-server': null });

  const parsed = JSON.parse(result);
  strictEqual(parsed.mcpServers['my-server'], undefined, 'removed key should be gone');
  ok(parsed.mcpServers['other-owned-server'], 'other owned entries must survive');
  ok(parsed.mcpServers['human-server'], 'human entries must survive a deactivation write');
});

test('mergeConfig: updating an existing Scopewatch-owned entry overwrites only that entry', () => {
  const existing = JSON.stringify({
    mcpServers: {
      'my-server': { command: 'scopewatch-run', args: ['my-server', 'claude-code'], env: { OLD: 'value' } },
      'human-server': { command: 'node', args: ['x.js'] },
    },
  });

  const result = mergeConfig(existing, new Set(['my-server']), {
    'my-server': { command: 'scopewatch-run', args: ['my-server', 'claude-code'] },
  });

  const parsed = JSON.parse(result);
  deepStrictEqual(parsed.mcpServers['my-server'], { command: 'scopewatch-run', args: ['my-server', 'claude-code'] });
  ok(parsed.mcpServers['human-server'], 'unrelated entry untouched by the update');
});

test('mergeConfig: refuses (throws) if asked to write a key not in the ownership set', () => {
  throws(
    () => mergeConfig(null, new Set(['allowed-server']), { 'not-allowed-server': { command: 'x', args: [] } }),
    /not in Scopewatch's ownership set/
  );
});
