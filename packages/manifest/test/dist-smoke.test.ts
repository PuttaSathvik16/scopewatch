import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
// Deliberately imported BY PACKAGE NAME, not '../src/...' - this forces real
// module resolution through package.json's "exports"/"main" into dist/, the
// same path an external consumer (e.g. @scopewatch/diff-engine or
// @scopewatch/client-adapters) actually takes. This is the exact mechanism
// that caught the Phase D bug where @scopewatch/state's dist/ was missing its
// schema files - every other package needs the same check, not just the one
// that already broke. Verified: renaming this package's dist/ away makes this
// test fail to resolve at all, proving it is not silently falling back to source.
import { parseManifest, isServerManifest } from '@scopewatch/manifest';

test('dist smoke: @scopewatch/manifest parses a real manifest through its compiled output', () => {
  const raw = {
    schemaVersion: 1,
    version: '1.0.0',
    source: { type: 'npm', location: 'example' },
    checksum: 'sha256:abc',
    tools: [{ id: 'reader', name: 'Reader', description: 'reads things' }],
    capabilities: [{ tool_id: 'reader', verb: 'read', resource: 'repo:owner/name', provenance: 'declared' }],
    secrets: [],
  };

  const result = parseManifest(raw);
  ok(result.ok, `Expected successful parse through compiled dist/, got: ${JSON.stringify(result)}`);
  if (result.ok) {
    strictEqual(result.value.version, '1.0.0');
    ok(isServerManifest(result.value), 'parsed data should satisfy the isServerManifest type guard');
  }
});

test('dist smoke: round-trip through JSON.stringify preserves data (compiled output)', () => {
  const raw = {
    schemaVersion: 1,
    version: '2.0.0',
    source: { type: 'git', location: 'https://example.com/repo.git' },
    checksum: 'sha256:def',
    tools: [{ id: 'writer', name: 'Writer', description: 'writes things' }],
    capabilities: [{ tool_id: 'writer', verb: 'write', resource: 'repo:owner/name', provenance: 'declared' }],
    secrets: [{ id: 'API_TOKEN', description: 'token', required: true, used_by: ['writer'] }],
  };

  const parsed = parseManifest(raw);
  ok(parsed.ok);
  if (parsed.ok) {
    const roundTripped = JSON.parse(JSON.stringify(parsed.value));
    deepStrictEqual(roundTripped, parsed.value);
  }
});
