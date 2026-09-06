import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { storeSecret, retrieveSecret, deleteSecret, injectSecrets } from '../src/keychain.js';
import { redact, _clearAllLiveSecretsForTesting } from '../src/logger.js';

// Real round-trip through this machine's actual OS keychain (macOS in this dev
// environment) via the platform dispatcher, proving storeSecret/retrieveSecret/
// deleteSecret work end-to-end and that the try/finally redaction-registration
// guarantee holds even when a batch partially fails.

const REF_A = `scopewatch-dispatch-test-a-${process.pid}`;
const REF_B_MISSING = `scopewatch-dispatch-test-b-missing-${process.pid}`;

test('storeSecret/retrieveSecret/deleteSecret round-trip via the platform dispatcher', () => {
  const value = 'dispatch-round-trip-value';

  try {
    const storeResult = storeSecret(REF_A, value);
    strictEqual(storeResult.ok, true, `store failed: ${!storeResult.ok && storeResult.error.message}`);

    const retrieveResult = retrieveSecret(REF_A);
    strictEqual(retrieveResult.ok, true, `retrieve failed: ${!retrieveResult.ok && retrieveResult.error.message}`);
    if (retrieveResult.ok) strictEqual(retrieveResult.value, value);
  } finally {
    deleteSecret(REF_A);
  }
});

test('retrieveSecret registers the value for redaction even when used immediately after in a throwing context', () => {
  _clearAllLiveSecretsForTesting();
  const value = 'must-be-redacted-after-retrieval';

  try {
    storeSecret(REF_A, value);

    try {
      const result = retrieveSecret(REF_A);
      if (result.ok) {
        throw new Error('simulated failure right after successful retrieval');
      }
    } catch {
      // swallow - the point is only to prove registration already happened
      // before this catch block runs
    }

    const redacted = redact(`the value was ${value}`);
    ok(!redacted.includes(value), 'value must be registered for redaction even though a throw happened right after retrieval');
  } finally {
    deleteSecret(REF_A);
    _clearAllLiveSecretsForTesting();
  }
});

test('injectSecrets: a later ref failing does not un-protect an earlier ref that already succeeded', () => {
  _clearAllLiveSecretsForTesting();
  const valueA = 'first-secret-in-batch-value';

  try {
    storeSecret(REF_A, valueA);
    // REF_B_MISSING is deliberately never stored, so its retrieval will fail

    const result = injectSecrets([
      { envVar: 'FIRST_TOKEN', ref: REF_A },
      { envVar: 'SECOND_TOKEN', ref: REF_B_MISSING },
    ]);

    strictEqual(result.ok, false, 'batch should fail because the second ref does not exist');

    // Even though the batch failed, the FIRST secret's value must still be
    // protected - it was successfully retrieved before the second one failed.
    const redacted = redact(`env would have included ${valueA}`);
    ok(
      !redacted.includes(valueA),
      `First secret's value was not protected after a later ref failed. Redacted: "${redacted}"`
    );
  } finally {
    deleteSecret(REF_A);
    _clearAllLiveSecretsForTesting();
  }
});

test('injectSecrets: successful batch returns an env map keyed by envVar name', () => {
  _clearAllLiveSecretsForTesting();
  const value = 'full-batch-success-value';

  try {
    storeSecret(REF_A, value);

    const result = injectSecrets([{ envVar: 'MY_TOKEN', ref: REF_A }]);
    strictEqual(result.ok, true);
    if (result.ok) {
      strictEqual(result.env['MY_TOKEN'], value);
    }
  } finally {
    deleteSecret(REF_A);
    _clearAllLiveSecretsForTesting();
  }
});
