import { execFileSync } from 'node:child_process';
import { MIN_NODE_VERSION, nodeNotInstalledError, nodeVersionTooOldError, npmNotInstalledError } from './errors.js';
import type { InstallError } from './errors.js';

export type PrerequisiteCheckResult =
  | { ok: true; nodeVersion: string; npmVersion: string }
  | { ok: false; error: InstallError };

/** Injected for testability - avoids spawning real processes in unit tests. */
export type CommandRunner = (command: string, args: string[]) => string;

const defaultRunner: CommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: 'utf-8', windowsHide: true });

/**
 * Check that Node.js and npm are present and that Node meets the minimum version.
 * Runs 'node --version' and 'npm --version' as external commands (not process.version)
 * so this reflects what npm/npx will actually invoke on PATH, and so it stays testable
 * via dependency injection without depending on the test runner's own Node version.
 */
export function checkPrerequisites(runner: CommandRunner = defaultRunner): PrerequisiteCheckResult {
  let nodeVersionRaw: string;
  try {
    nodeVersionRaw = runner('node', ['--version']).trim();
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return { ok: false, error: nodeNotInstalledError() };
    }
    return { ok: false, error: nodeNotInstalledError() };
  }

  const nodeVersion = nodeVersionRaw.replace(/^v/, '');
  if (!satisfiesMinVersion(nodeVersion, MIN_NODE_VERSION)) {
    return { ok: false, error: nodeVersionTooOldError(nodeVersion) };
  }

  let npmVersion: string;
  try {
    npmVersion = runner('npm', ['--version']).trim();
  } catch (err: any) {
    return { ok: false, error: npmNotInstalledError() };
  }

  return { ok: true, nodeVersion, npmVersion };
}

/** Minimal semver major.minor.patch comparison - sufficient for a floor check. */
export function satisfiesMinVersion(version: string, minVersion: string): boolean {
  const v = parseSemver(version);
  const min = parseSemver(minVersion);
  if (!v || !min) return false;

  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
}

function parseSemver(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
