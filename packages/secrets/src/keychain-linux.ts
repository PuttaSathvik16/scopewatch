import { spawnSync } from 'node:child_process';
import { KEYCHAIN_SERVICE_NAME } from './secret-ref.js';
import { itemNotFoundError, noKeychainBackendError, unrecognizedSecretError, SecretError } from './errors.js';

export type SpawnFn = (
  command: string,
  args: string[],
  options: { input?: string }
) => { status: number | null; stdout: string; stderr: string; spawnError?: NodeJS.ErrnoException | undefined };

const defaultSpawn: SpawnFn = (command, args, options) => {
  const result = spawnSync(command, args, { input: options.input, encoding: 'utf-8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    spawnError: result.error as NodeJS.ErrnoException | undefined,
  };
};

/**
 * `secret-tool` (from libsecret-tools) talks to the Secret Service API over
 * D-Bus. On headless/CI Linux with no Secret Service daemon running (no
 * gnome-keyring, no D-Bus session), either the binary itself is missing
 * (ENOENT) or it runs but fails to connect - both are detected here and
 * produce noKeychainBackendError rather than any file-based fallback (see
 * errors.ts doc comment: a fallback would require its own encryption key
 * stored somewhere, recreating the exact problem it claims to solve).
 */
function detectNoBackend(result: { status: number | null; stderr: string; spawnError?: NodeJS.ErrnoException | undefined }): string | null {
  if (result.spawnError?.code === 'ENOENT') {
    return 'secret-tool is not installed (part of the libsecret-tools / libsecret-utils package)';
  }
  if (/no such interface|cannot autolaunch|couldn'?t connect|not provided by any \.service|org\.freedesktop\.secrets/i.test(result.stderr)) {
    return 'no D-Bus Secret Service is running (no gnome-keyring or equivalent available in this session)';
  }
  return null;
}

export function linuxStore(ref: string, value: string, spawn: SpawnFn = defaultSpawn): SecretError | null {
  const result = spawn(
    'secret-tool',
    ['store', '--label', `scopewatch:${ref}`, 'service', KEYCHAIN_SERVICE_NAME, 'account', ref],
    { input: `${value}\n` }
  );

  const backendGap = detectNoBackend(result);
  if (backendGap) return noKeychainBackendError('Linux', backendGap);

  if (result.status === 0) return null;
  return unrecognizedSecretError(result.stderr);
}

export function linuxRetrieve(ref: string, spawn: SpawnFn = defaultSpawn): { value: string } | { error: SecretError } {
  const result = spawn('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE_NAME, 'account', ref], {});

  const backendGap = detectNoBackend(result);
  if (backendGap) return { error: noKeychainBackendError('Linux', backendGap) };

  if (result.status === 0 && result.stdout.length > 0) {
    return { value: result.stdout.replace(/\n$/, '') };
  }
  if (result.status !== 0) {
    return { error: itemNotFoundError(ref) };
  }
  return { error: unrecognizedSecretError(result.stderr) };
}

export function linuxDelete(ref: string, spawn: SpawnFn = defaultSpawn): SecretError | null {
  const result = spawn('secret-tool', ['clear', 'service', KEYCHAIN_SERVICE_NAME, 'account', ref], {});

  const backendGap = detectNoBackend(result);
  if (backendGap) return noKeychainBackendError('Linux', backendGap);

  if (result.status === 0) return null;
  return itemNotFoundError(ref);
}
