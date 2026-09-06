import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { macosStore, macosRetrieve, macosDelete } from '../src/keychain-macos.js';
import type { SpawnFn } from '../src/keychain-macos.js';

// Tests below in the first group use a REAL `security` subprocess against this
// machine's actual login keychain (this dev environment is macOS/Darwin), using
// a distinctive test-only account reference and deleting it in a finally block
// so no test artifact survives a run, pass or fail.
//
// The second group uses an injected SpawnFn to test error-path behavior
// (unrecognized failures, item-not-found) without touching the real keychain
// at all - fully offline/deterministic.

const TEST_REF = `scopewatch-test-${process.pid}-${Date.now()}`;

// Real-subprocess tests below call `security` with no injected SpawnFn - they
// only make sense on macOS. Found via a real CI run: with no guard, these ran
// unconditionally on ubuntu-latest/windows-latest too, where `security`
// doesn't exist, producing a hard failure indistinguishable at a glance from
// an actual product bug.
const REAL_ROUND_TRIP = { skip: process.platform !== 'darwin' ? 'requires the real macOS `security` binary' : false };

test('macosStore + macosRetrieve: real round-trip through the actual login keychain', REAL_ROUND_TRIP, async () => {
  const value = 'real-keychain-round-trip-value';

  try {
    const storeError = macosStore(TEST_REF, value);
    strictEqual(storeError, null, `store should succeed, got: ${storeError?.message}`);

    const retrieveResult = macosRetrieve(TEST_REF);
    ok('value' in retrieveResult, `retrieve should succeed, got error: ${(retrieveResult as any).error?.message}`);
    if ('value' in retrieveResult) {
      strictEqual(retrieveResult.value, value, 'retrieved value must exactly match what was stored');
    }
  } finally {
    macosDelete(TEST_REF);
  }
});

test('macosStore: the secret value never appears in the store subprocess argv', REAL_ROUND_TRIP, async () => {
  // Proves the `-w` (no value) design by construction: capture what argv the
  // real implementation actually passes to spawn, and assert the secret string
  // is not one of those arguments - it can only have reached the child via stdin.
  const value = 'must-never-appear-in-argv-xyz789';
  let capturedArgs: string[] = [];

  const spyingSpawn: SpawnFn = (command, args, options) => {
    capturedArgs = args;
    // Delegate to a real spawn so this is still a genuine end-to-end check,
    // just with visibility into what was actually passed as argv.
    const result = spawnSync(command, args, { input: options.input, encoding: 'utf-8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };

  try {
    macosStore(TEST_REF, value, spyingSpawn);
    ok(!capturedArgs.includes(value), `Secret value found in argv: ${JSON.stringify(capturedArgs)}`);
    ok(capturedArgs[capturedArgs.length - 1] === '-w', "'-w' must be the last argv element with no value following it");
  } finally {
    macosDelete(TEST_REF);
  }
});

test('macosDelete: cleans up so the test account never lingers in the real keychain', REAL_ROUND_TRIP, async () => {
  macosStore(TEST_REF, 'to-be-deleted');
  const deleteError = macosDelete(TEST_REF);
  strictEqual(deleteError, null);

  const afterDelete = macosRetrieve(TEST_REF);
  ok('error' in afterDelete, 'retrieving after delete should fail');
  if ('error' in afterDelete) {
    strictEqual(afterDelete.error.category, 'item_not_found');
  }
});

// --- Offline, injected-spawn tests for error paths ---

test('macosRetrieve: item not found -> item_not_found category (offline, injected spawn)', () => {
  const spawn: SpawnFn = () => ({
    status: 44,
    stdout: '',
    stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n',
  });

  const result = macosRetrieve('nonexistent-ref', spawn);
  ok('error' in result);
  if ('error' in result) {
    strictEqual(result.error.category, 'item_not_found');
  }
});

test('macosStore: unrecognized failure -> unrecognized category with raw detail preserved (offline)', () => {
  const spawn: SpawnFn = () => ({
    status: 1,
    stdout: '',
    stderr: 'security: some unexpected keychain error occurred\n',
  });

  const error = macosStore('some-ref', 'some-value', spawn);
  ok(error);
  strictEqual(error!.category, 'unrecognized');
  ok(error!.detail?.includes('unexpected keychain error'));
});

test('macosStore: injected spawn never receives the value as an arg, only via input option', () => {
  let sawValueInArgs = false;
  let sawValueInInput = false;
  const secret = 'injected-spy-value';

  const spawn: SpawnFn = (_cmd, args, options) => {
    if (args.some((a) => a.includes(secret))) sawValueInArgs = true;
    if (options.input?.includes(secret)) sawValueInInput = true;
    return { status: 0, stdout: '', stderr: '' };
  };

  macosStore('spy-ref', secret, spawn);
  strictEqual(sawValueInArgs, false, 'value must never be passed as a spawn argument');
  strictEqual(sawValueInInput, true, 'value must be passed via stdin (input option)');
});
