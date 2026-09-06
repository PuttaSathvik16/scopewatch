import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { windowsStore, windowsRetrieve, windowsDelete } from '../src/keychain-windows.js';
import type { SpawnFn } from '../src/keychain-windows.js';

// This dev environment is macOS, not Windows - powershell.exe / Win32
// Credential Manager cannot be exercised for real here. These tests verify
// the implementation's CONTRACT (argv never contains the secret value; the
// value is only ever passed via the input/stdin option) using an injected
// SpawnFn. The PowerShell/P/Invoke script content itself is implemented per
// documented Win32 API contracts but is UNVERIFIED on a real Windows machine -
// see the warning comment in src/keychain-windows.ts. This must be validated
// on real Windows before being relied on in production.

test('windowsStore: the secret value never appears in the -Command argument string', () => {
  const secret = 'windows-argv-safety-check-value';
  let capturedArgs: string[] = [];

  const spawn: SpawnFn = (_cmd, args) => {
    capturedArgs = args;
    return { status: 0, stdout: '', stderr: '' };
  };

  windowsStore('some-ref', secret, spawn);

  const commandArg = capturedArgs.find((a) => a.includes('CredWrite')) ?? capturedArgs.join('\n');
  ok(
    !commandArg.includes(secret),
    `Secret value must never be interpolated into the -Command script text. Found in: "${commandArg.slice(0, 200)}..."`
  );
});

test('windowsStore: the secret value IS passed via the input (stdin) option', () => {
  const secret = 'windows-stdin-check-value';
  let capturedInput: string | undefined;

  const spawn: SpawnFn = (_cmd, _args, options) => {
    capturedInput = options.input;
    return { status: 0, stdout: '', stderr: '' };
  };

  windowsStore('some-ref', secret, spawn);
  ok(capturedInput?.includes(secret), 'value should be passed via stdin, not argv');
});

test('windowsStore: the reference (non-sensitive) IS embedded in the command text, as -TargetName equivalent', () => {
  const ref = 'server-x:API_KEY';
  let capturedArgs: string[] = [];

  const spawn: SpawnFn = (_cmd, args) => {
    capturedArgs = args;
    return { status: 0, stdout: '', stderr: '' };
  };

  windowsStore(ref, 'irrelevant-value', spawn);
  const commandText = capturedArgs.join('\n');
  ok(commandText.includes(ref), 'the non-sensitive reference should appear in the script (this is fine - only the value is sensitive)');
});

test('windowsRetrieve: successful read returns the value from stdout', () => {
  const spawn: SpawnFn = () => ({ status: 0, stdout: 'the-retrieved-value', stderr: '' });
  const result = windowsRetrieve('ref', spawn);
  ok('value' in result);
  if ('value' in result) strictEqual(result.value, 'the-retrieved-value');
});

test('windowsRetrieve: exit code 2 (CredRead failed) -> item_not_found', () => {
  const spawn: SpawnFn = () => ({ status: 2, stdout: '', stderr: '' });
  const result = windowsRetrieve('ref', spawn);
  ok('error' in result);
  if ('error' in result) strictEqual(result.error.category, 'item_not_found');
});

test('windowsDelete: exit code 2 (CredDelete failed) -> item_not_found', () => {
  const spawn: SpawnFn = () => ({ status: 2, stdout: '', stderr: '' });
  const error = windowsDelete('ref', spawn);
  ok(error);
  strictEqual(error!.category, 'item_not_found');
});

test('windowsStore: unexpected failure -> unrecognized category', () => {
  const spawn: SpawnFn = () => ({ status: 1, stdout: '', stderr: 'some powershell error' });
  const error = windowsStore('ref', 'value', spawn);
  ok(error);
  strictEqual(error!.category, 'unrecognized');
});
