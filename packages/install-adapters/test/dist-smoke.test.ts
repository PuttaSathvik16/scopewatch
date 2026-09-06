import { test } from 'node:test';
import { ok } from 'node:assert';
// Imported BY PACKAGE NAME to force real dist/ resolution.
import { checkPrerequisites, MIN_NODE_VERSION } from '@scopewatch/install-adapters';

test('dist smoke: @scopewatch/install-adapters runs a real prerequisite check through compiled output', () => {
  const result = checkPrerequisites();
  ok(typeof result.ok === 'boolean', 'checkPrerequisites should return a real structured result through compiled dist/');
  ok(MIN_NODE_VERSION === '22.0.0');
});
