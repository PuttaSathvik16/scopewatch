export type InstallErrorCategory =
  | 'node_not_installed'
  | 'node_version_too_old'
  | 'npm_not_installed'
  | 'package_not_found'
  | 'network_unreachable'
  | 'permission_denied'
  | 'entry_point_broken'
  | 'unrecognized';

export class InstallError extends Error {
  category: InstallErrorCategory;
  /** Raw underlying detail (npm stderr, spawn error, etc.), for diagnostics/logs. */
  detail: string | undefined;

  constructor(category: InstallErrorCategory, message: string, detail?: string) {
    super(message);
    this.name = 'InstallError';
    this.category = category;
    this.detail = detail;
  }
}

export const MIN_NODE_VERSION = '22.0.0';
export const RECOMMENDED_NODE_VERSION = '24.x';

export function nodeNotInstalledError(): InstallError {
  return new InstallError(
    'node_not_installed',
    `Node.js is not installed or not on PATH. Install Node.js ${MIN_NODE_VERSION} or later ` +
      `(${RECOMMENDED_NODE_VERSION} recommended) from https://nodejs.org, then run 'scopewatch doctor' again.`
  );
}

export function nodeVersionTooOldError(found: string): InstallError {
  return new InstallError(
    'node_version_too_old',
    `Node.js ${found} is installed, but Scopewatch requires ${MIN_NODE_VERSION} or later ` +
      `(${RECOMMENDED_NODE_VERSION} recommended). Upgrade Node.js, then run 'scopewatch doctor' again.`
  );
}

export function npmNotInstalledError(): InstallError {
  return new InstallError(
    'npm_not_installed',
    `npm is not installed or not on PATH. npm ships with Node.js - reinstalling Node.js ` +
      `from https://nodejs.org should restore it.`
  );
}

export function packageNotFoundError(name: string): InstallError {
  return new InstallError(
    'package_not_found',
    `Package '${name}' was not found in the npm registry. Check the package name for typos, ` +
      `or confirm it's published.`
  );
}

export function networkUnreachableError(): InstallError {
  return new InstallError(
    'network_unreachable',
    `Could not reach the npm registry (network error). Check your internet connection and ` +
      `proxy settings, then retry.`
  );
}

export function permissionDeniedError(path: string): InstallError {
  return new InstallError(
    'permission_denied',
    `Permission denied writing to ${path}. Scopewatch installs locally and should not require ` +
      `elevated privileges - check ownership of ${path}.`
  );
}

/**
 * Scope note: this category is intentionally minimal for Phase D. It confirms the
 * package's declared entry point exists on disk and, for a plain Node script, that
 * requiring/importing it doesn't throw synchronously. It does NOT attempt an MCP
 * JSON-RPC handshake or any protocol-level connectivity check - that is the job of
 * `scopewatch test <server>` and the diagnostics module (Phase I), which own
 * connection validation. Do not extend this check into protocol testing; a broken
 * or incompletely-published package is the failure this category exists to catch,
 * not "does this server actually speak MCP correctly."
 */
export function entryPointBrokenError(name: string, detail: string): InstallError {
  return new InstallError(
    'entry_point_broken',
    `'${name}' installed successfully but its entry point failed a basic load check: ` +
      `${truncate(detail, 300)}. This usually means a missing runtime dependency or an ` +
      `incompatible Node version for this package.`,
    detail
  );
}

export function unrecognizedInstallError(code: string | undefined, rawOutput: string): InstallError {
  return new InstallError(
    'unrecognized',
    `Install failed with an unrecognized error${code ? ` (${code})` : ''}. ` +
      `Raw npm output: ${truncate(rawOutput, 500)}`,
    rawOutput
  );
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max) + '...' : oneLine;
}
