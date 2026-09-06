import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
// Imported BY PACKAGE NAME (self-import via the workspace symlink), not
// '../src/...' as every other test file in this package does. The
// exit-check test proved @scopewatch/state's dist/ works when consumed
// externally, but nothing had yet proven @scopewatch/secrets' OWN dist/
// output is sound when consumed the way a future @scopewatch/client-adapters
// or the CLI app actually will.
import { secretRef, redact, registerLiveSecret, _clearAllLiveSecretsForTesting } from '@scopewatch/secrets';

test('dist smoke: @scopewatch/secrets exports work through compiled output', () => {
  strictEqual(secretRef('server-a', 'TOKEN'), 'server-a:TOKEN');

  _clearAllLiveSecretsForTesting();
  registerLiveSecret('smoke-test-secret-value');
  const result = redact('the value is smoke-test-secret-value');
  ok(!result.includes('smoke-test-secret-value'), 'redaction should work through compiled dist/');
  ok(result.includes('[REDACTED]'));
  _clearAllLiveSecretsForTesting();
});
