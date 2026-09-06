import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { linuxStore, linuxRetrieve, linuxDelete } from '../src/keychain-linux.js';
import type { SpawnFn } from '../src/keychain-linux.js';

// This dev environment is macOS, not Linux, so all tests here use an injected
// SpawnFn simulating secret-tool's real behavior/output - fully offline.

test('linuxStore: secret-tool missing (ENOENT) -> no_keychain_backend, names the reason', () => {
  const spawn: SpawnFn = () => {
    const err = new Error('spawn secret-tool ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return { status: null, stdout: '', stderr: '', spawnError: err };
  };

  const error = linuxStore('some-ref', 'some-value', spawn);
  ok(error);
  strictEqual(error!.category, 'no_keychain_backend');
  ok(error!.message.includes('not installed'), `Expected message naming the missing binary. Got: "${error!.message}"`);
});

test('linuxStore: secret-tool present but no D-Bus Secret Service running -> no_keychain_backend', () => {
  const spawn: SpawnFn = () => ({
    status: 1,
    stdout: '',
    stderr: "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n",
  });

  const error = linuxStore('some-ref', 'some-value', spawn);
  ok(error);
  strictEqual(error!.category, 'no_keychain_backend');
  ok(
    error!.message.includes('No system keychain backend'),
    `Expected the actionable no-backend message. Got: "${error!.message}"`
  );
});

test('linuxStore: value is passed via stdin, never as an argv element', () => {
  let sawValueInArgs = false;
  let sawValueInInput = false;
  const secret = 'linux-spy-secret-value';

  const spawn: SpawnFn = (_cmd, args, options) => {
    if (args.some((a) => a.includes(secret))) sawValueInArgs = true;
    if (options.input?.includes(secret)) sawValueInInput = true;
    return { status: 0, stdout: '', stderr: '' };
  };

  linuxStore('spy-ref', secret, spawn);
  strictEqual(sawValueInArgs, false, 'value must never be passed as a spawn argument');
  strictEqual(sawValueInInput, true, 'value must be passed via stdin');
});

test('linuxStore: successful store returns no error', () => {
  const spawn: SpawnFn = () => ({ status: 0, stdout: '', stderr: '' });
  const error = linuxStore('ref', 'value', spawn);
  strictEqual(error, null);
});

test('linuxRetrieve: successful lookup returns the value', () => {
  const spawn: SpawnFn = () => ({ status: 0, stdout: 'retrieved-value\n', stderr: '' });
  const result = linuxRetrieve('ref', spawn);
  ok('value' in result);
  if ('value' in result) strictEqual(result.value, 'retrieved-value');
});

test('linuxRetrieve: item not found -> item_not_found category', () => {
  const spawn: SpawnFn = () => ({ status: 1, stdout: '', stderr: '' });
  const result = linuxRetrieve('ref', spawn);
  ok('error' in result);
  if ('error' in result) strictEqual(result.error.category, 'item_not_found');
});

test('linuxDelete: no backend detection also applies to delete', () => {
  const spawn: SpawnFn = () => {
    const err = new Error('spawn secret-tool ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    return { status: null, stdout: '', stderr: '', spawnError: err };
  };

  const error = linuxDelete('ref', spawn);
  ok(error);
  strictEqual(error!.category, 'no_keychain_backend');
});
