import { test } from 'node:test';
import { strictEqual } from 'node:assert';
// Imported BY PACKAGE NAME to force real dist/ resolution.
import { inferCapabilities } from '@scopewatch/capability-inference';

test('dist smoke: @scopewatch/capability-inference works through compiled output', () => {
  const result = inferCapabilities('test-server', [
    { name: 'delete_thing', description: 'Deletes a thing permanently.' },
  ]);
  strictEqual(result.capabilities[0]!.verb, 'delete');
  strictEqual(result.capabilities[0]!.provenance, 'inferred');
});
