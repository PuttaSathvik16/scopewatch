import { macosStore, macosRetrieve, macosDelete } from './keychain-macos.js';
import { linuxStore, linuxRetrieve, linuxDelete } from './keychain-linux.js';
import { windowsStore, windowsRetrieve, windowsDelete } from './keychain-windows.js';
import { registerLiveSecret } from './logger.js';
import type { SecretError } from './errors.js';

export type KeychainResult = { ok: true } | { ok: false; error: SecretError };
export type RetrieveResult = { ok: true; value: string } | { ok: false; error: SecretError };

function platform(): NodeJS.Platform {
  return process.platform;
}

export function storeSecret(ref: string, value: string): KeychainResult {
  const p = platform();
  const error =
    p === 'darwin' ? macosStore(ref, value) : p === 'linux' ? linuxStore(ref, value) : windowsStore(ref, value);

  return error ? { ok: false, error } : { ok: true };
}

/**
 * Retrieve a secret and register it for log redaction in the same call. The
 * registration happens in a finally block around the platform-specific
 * retrieval: if a value was actually obtained, it is guaranteed to be
 * registered even if something else in this function throws afterward - a
 * later log line can never mention a raw value that was successfully
 * retrieved but not yet protected.
 */
export function retrieveSecret(ref: string): RetrieveResult {
  const p = platform();
  let value: string | undefined;

  try {
    const result = p === 'darwin' ? macosRetrieve(ref) : p === 'linux' ? linuxRetrieve(ref) : windowsRetrieve(ref);
    if ('error' in result) {
      return { ok: false, error: result.error };
    }
    value = result.value;
    return { ok: true, value: result.value };
  } finally {
    if (value !== undefined) registerLiveSecret(value);
  }
}

export function deleteSecret(ref: string): KeychainResult {
  const p = platform();
  const error = p === 'darwin' ? macosDelete(ref) : p === 'linux' ? linuxDelete(ref) : windowsDelete(ref);

  return error ? { ok: false, error } : { ok: true };
}

/**
 * Retrieve multiple secrets for injection into a spawned server process's env.
 * Each retrieval is independently registered for redaction (via retrieveSecret's
 * own finally block) BEFORE this function's loop can move to the next ref or
 * throw - so if retrieving secret #2 fails, secret #1's value (already
 * retrieved) is still protected, not skipped because the batch as a whole
 * later errors.
 */
export function injectSecrets(refs: { envVar: string; ref: string }[]): { ok: true; env: Record<string, string> } | { ok: false; error: SecretError } {
  const env: Record<string, string> = {};

  for (const { envVar, ref } of refs) {
    const result = retrieveSecret(ref);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    env[envVar] = result.value;
  }

  return { ok: true, env };
}
