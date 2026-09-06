import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  InstallError,
  packageNotFoundError,
  networkUnreachableError,
  permissionDeniedError,
  entryPointBrokenError,
  unrecognizedInstallError,
} from './errors.js';
import { checkPrerequisites, type CommandRunner } from './prerequisites.js';

export type InstallResult =
  | { ok: true; installPath: string }
  | { ok: false; error: InstallError };

/** Injected process runner for testability - avoids spawning real npm in unit tests. */
export type InstallRunner = (
  command: string,
  args: string[]
) => { code: number; stdout: string; stderr: string };

/**
 * Categorize an npm install failure from its exit output. Matches on npm's own
 * stable error codes (E404, ETARGET, ENOTFOUND, etc.) rather than free-text
 * pattern matching - codes are stable across npm versions, wording is not.
 */
export function categorizeNpmFailure(packageName: string, stderr: string, installPath: string): InstallError {
  const combined = stderr;

  if (/\bE404\b/.test(combined) || /\bETARGET\b/.test(combined)) {
    return packageNotFoundError(packageName);
  }
  if (
    /\bENOTFOUND\b/.test(combined) ||
    /\bEAI_AGAIN\b/.test(combined) ||
    /\bECONNREFUSED\b/.test(combined) ||
    /\bETIMEDOUT\b/.test(combined)
  ) {
    return networkUnreachableError();
  }
  if (/\bEACCES\b/.test(combined) || /\bEPERM\b/.test(combined)) {
    return permissionDeniedError(installPath);
  }

  const codeMatch = combined.match(/\bE[A-Z0-9]+\b/);
  return unrecognizedInstallError(codeMatch?.[0], combined);
}

/**
 * Scope note: see errors.ts's entryPointBrokenError doc comment. This is a load
 * smoke-check, not a protocol handshake. It confirms the entry point file exists
 * and, if resolvable as a plain module, that importing it doesn't throw synchronously.
 */
export async function checkEntryPoint(packageName: string, installPath: string, entryFile: string): Promise<InstallError | null> {
  const fullPath = join(installPath, 'node_modules', packageName, entryFile);

  if (!existsSync(fullPath)) {
    return entryPointBrokenError(packageName, `entry point file not found at ${fullPath}`);
  }

  try {
    await import(pathToFileURL(fullPath).href);
    return null;
  } catch (err: any) {
    return entryPointBrokenError(packageName, err?.message ?? String(err));
  }
}

/**
 * Install a package via npm. Prerequisites are checked FIRST - a bad environment
 * (missing Node/npm, wrong version) is reported before any install is attempted,
 * never discovered midway through a partial install.
 */
export function installPackage(
  packageName: string,
  installPath: string,
  runner: InstallRunner,
  prereqRunner?: CommandRunner
): InstallResult {
  const prereqs = checkPrerequisites(prereqRunner);
  if (!prereqs.ok) {
    return { ok: false, error: prereqs.error };
  }

  const result = runner('npm', ['install', packageName, '--prefix', installPath]);

  if (result.code !== 0) {
    return { ok: false, error: categorizeNpmFailure(packageName, result.stderr, installPath) };
  }

  return { ok: true, installPath };
}
