export type SecretErrorCategory =
  | 'no_keychain_backend'
  | 'item_not_found'
  | 'not_a_tty'
  | 'prompt_cancelled'
  | 'unrecognized';

export class SecretError extends Error {
  category: SecretErrorCategory;
  detail: string | undefined;

  constructor(category: SecretErrorCategory, message: string, detail?: string) {
    super(message);
    this.name = 'SecretError';
    this.category = category;
    this.detail = detail;
  }
}

/**
 * Deliberate design decision (see CLAUDE.md Phase D): when no real OS keychain
 * backend is available (e.g. headless Linux with no Secret Service/D-Bus session
 * running), Scopewatch refuses to store secrets rather than falling back to an
 * encrypted file. Any such fallback would require a custom encryption key stored
 * *somewhere*, which recreates the exact "no plaintext anywhere" problem it's
 * meant to solve. Failing loudly with a clear recovery path is the safe default
 * required by the brief's UX rule 4, not a limitation to engineer around.
 */
export function noKeychainBackendError(platform: string, detail: string): SecretError {
  return new SecretError(
    'no_keychain_backend',
    `No system keychain backend is available on this ${platform} machine (${detail}). ` +
      `Scopewatch will not store secrets without a real OS keychain backing them - install ` +
      `and run a Secret Service provider (e.g. gnome-keyring) within a session that has one, ` +
      `then retry.`,
    detail
  );
}

export function itemNotFoundError(ref: string): SecretError {
  return new SecretError('item_not_found', `No secret found in the system keychain for '${ref}'.`);
}

export function notATtyError(): SecretError {
  return new SecretError(
    'not_a_tty',
    `Cannot securely prompt for a secret: stdin is not an interactive terminal. ` +
      `Run this command directly in a terminal, not piped or redirected.`
  );
}

export function promptCancelledError(): SecretError {
  return new SecretError('prompt_cancelled', `Secret entry was cancelled.`);
}

export function unrecognizedSecretError(rawOutput: string): SecretError {
  return new SecretError(
    'unrecognized',
    `Keychain operation failed with an unrecognized error: ${truncate(rawOutput, 300)}`,
    rawOutput
  );
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '...' : oneLine;
}
