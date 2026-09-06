import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
// Imported BY PACKAGE NAME to force real dist/ resolution - see
// packages/manifest/test/dist-smoke.test.ts for why this matters. diff-engine
// only ever imports @scopewatch/manifest via `import type`, which is erased at
// compile time - meaning nothing before this test has ever actually loaded
// manifest's compiled output through a real runtime dependency edge. This test
// closes that gap for diff-engine's own dist/, and a real cross-package
// scenario (this test importing both compiled packages together) exercises
// the dependency graph end-to-end.
import { computeDiff, renderDiff, extractSummary } from '@scopewatch/diff-engine';
import type { ServerManifest } from '@scopewatch/manifest';

const from: ServerManifest = {
  schemaVersion: 1,
  version: '1.0.0',
  source: { type: 'npm', location: 'example' },
  checksum: 'sha256:from',
  tools: [{ id: 'reader', name: 'Reader', description: 'reads' }],
  capabilities: [{ tool_id: 'reader', verb: 'read', resource: 'repo:owner/name', provenance: 'declared' }],
  secrets: [],
};

const to: ServerManifest = {
  ...from,
  version: '1.1.0',
  checksum: 'sha256:to',
  tools: [...from.tools, { id: 'deleter', name: 'Deleter', description: 'deletes' }],
  capabilities: [
    ...from.capabilities,
    { tool_id: 'deleter', verb: 'delete', resource: 'repo:owner/name', provenance: 'declared' },
  ],
};

test('dist smoke: @scopewatch/diff-engine computes a real diff through compiled output', () => {
  const diff = computeDiff(from, to);

  strictEqual(diff.newly_destructive, true, 'new tool with delete access should be Tier 1 through compiled dist/');
  strictEqual(diff.riskLevel, 'high');

  const rendered = renderDiff(diff);
  ok(rendered.length > 0, 'renderDiff should produce output through compiled dist/');

  const summary = extractSummary(diff);
  ok(summary.toLowerCase().includes('deleter'), `Expected summary to mention the new tool. Got: "${summary}"`);
});
