import { spawnSync } from 'node:child_process';
import { KEYCHAIN_SERVICE_NAME } from './secret-ref.js';
import { itemNotFoundError, unrecognizedSecretError, SecretError } from './errors.js';

/** Injected for testability - avoids spawning the real `security` binary in unit tests. */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { input?: string }
) => { status: number | null; stdout: string; stderr: string };

const defaultSpawn: SpawnFn = (command, args, options) => {
  const result = spawnSync(command, args, { input: options.input, encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/**
 * Store a secret via macOS Keychain Services, using the `security` CLI.
 *
 * CRITICAL: `-w` must be the truly-last token in argv with NO value following
 * it (confirmed via `security add-generic-password -h`: "Use of the -p or -w
 * options is insecure. Specify -w as the last option to be prompted."). This
 * makes `security` read the password from stdin instead (as a confirm+retype
 * pair, "value\nvalue\n") rather than accepting it as a command-line argument -
 * verified empirically on this dev machine: `security` with `-w <value>` puts
 * the value in argv, visible via `ps`/Activity Monitor for the life of the
 * subprocess; `-w` alone does not. Do not "simplify" this back to `-w <value>`.
 */
export function macosStore(ref: string, value: string, spawn: SpawnFn = defaultSpawn): SecretError | null {
  const result = spawn(
    'security',
    ['add-generic-password', '-a', ref, '-s', KEYCHAIN_SERVICE_NAME, '-U', '-w'],
    { input: `${value}\n${value}\n` }
  );

  if (result.status === 0) return null;
  return unrecognizedSecretError(result.stderr);
}

export function macosRetrieve(ref: string, spawn: SpawnFn = defaultSpawn): { value: string } | { error: SecretError } {
  const result = spawn('security', ['find-generic-password', '-a', ref, '-s', KEYCHAIN_SERVICE_NAME, '-w'], {});

  if (result.status === 0) {
    return { value: result.stdout.replace(/\n$/, '') };
  }
  if (/could not be found/i.test(result.stderr)) {
    return { error: itemNotFoundError(ref) };
  }
  return { error: unrecognizedSecretError(result.stderr) };
}

export function macosDelete(ref: string, spawn: SpawnFn = defaultSpawn): SecretError | null {
  const result = spawn('security', ['delete-generic-password', '-a', ref, '-s', KEYCHAIN_SERVICE_NAME], {});

  if (result.status === 0) return null;
  if (/could not be found/i.test(result.stderr)) {
    return itemNotFoundError(ref);
  }
  return unrecognizedSecretError(result.stderr);
}
