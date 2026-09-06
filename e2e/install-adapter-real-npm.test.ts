import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPrerequisites } from '../packages/install-adapters/src/prerequisites.js';
import { categorizeNpmFailure, checkEntryPoint } from '../packages/install-adapters/src/npm-adapter.js';

/**
 * Real end-to-end coverage against the actual npm registry and this machine's
 * actual Node/npm installation. Deliberately kept out of `npm test`
 * (packages/**\/test/**) because it is network-dependent and would make the fast
 * inner-loop suite flaky. Run this file explicitly (`npm run test:e2e`) - on a
 * separate, less frequent cadence such as pre-release or a scheduled CI job.
 *
 * Uses 'ms' - a small, zero-dependency, long-stable npm package - purely as a
 * real target to install. Nothing about scopewatch depends on 'ms' itself.
 *
 * Note on structure: the install/categorization tests below call npm directly
 * and feed real output through categorizeNpmFailure/checkEntryPoint, rather
 * than going through the prerequisite-gated installPackage() wrapper. This is
 * deliberate: the prerequisite gate itself is exercised separately below
 * against this machine's REAL (non-fixture) Node/npm, and its result is
 * asserted honestly rather than bypassed - if this machine's Node is below
 * Scopewatch's minimum, that test says so, on purpose. Gating the *install*
 * tests on that same real result would make them fail on any dev machine
 * running an older-but-still-installing-fine Node, for a reason unrelated to
 * what those tests exist to check (real npm registry behavior).
 */

test('e2e: checkPrerequisites reports accurately against this machine\'s real Node/npm', () => {
  const result = checkPrerequisites(); // no injected runner - the real thing

  if (result.ok) {
    ok(/^\d+\.\d+\.\d+$/.test(result.nodeVersion), `nodeVersion should be a real semver string, got: ${result.nodeVersion}`);
    ok(/^\d+\.\d+\.\d+$/.test(result.npmVersion), `npmVersion should be a real semver string, got: ${result.npmVersion}`);
  } else {
    // Also a valid, meaningful outcome: this machine's real Node is below the
    // floor. Assert the category and message are still correct against real data.
    ok(
      result.error.category === 'node_version_too_old' || result.error.category === 'node_not_installed',
      `Unexpected failure category against a real environment: ${result.error.category}`
    );
    console.log(`[e2e] Note: this machine's real Node does not meet Scopewatch's minimum. ` + `Category: ${result.error.category}. Message: ${result.error.message}`);
  }
});

test('e2e: real npm install of a real, stable package succeeds', () => {
  const installPath = mkdtempSync(join(tmpdir(), 'scopewatch-e2e-'));

  try {
    let result: { code: number; stdout: string; stderr: string };
    try {
      const stdout = execFileSync('npm', ['install', 'ms', '--prefix', installPath], { encoding: 'utf-8' });
      result = { code: 0, stdout, stderr: '' };
    } catch (err: any) {
      result = {
        code: typeof err.status === 'number' ? err.status : 1,
        stdout: err.stdout?.toString() ?? '',
        stderr: err.stderr?.toString() ?? String(err.message ?? err),
      };
    }

    strictEqual(result.code, 0, `Expected real npm install of 'ms' to succeed. stderr: ${result.stderr}`);
    ok(existsSync(join(installPath, 'node_modules', 'ms')), 'ms should actually be present in node_modules');
  } finally {
    rmSync(installPath, { recursive: true, force: true });
  }
});

test('e2e: entry point smoke check passes for a real installed package', async () => {
  const installPath = mkdtempSync(join(tmpdir(), 'scopewatch-e2e-'));

  try {
    execFileSync('npm', ['install', 'ms', '--prefix', installPath], { encoding: 'utf-8' });

    // ms's package.json "main" is index.js
    const entryError = await checkEntryPoint('ms', installPath, 'index.js');
    strictEqual(entryError, null, `Expected a real, working package to pass the entry point smoke check. Got: ${entryError?.message}`);
  } finally {
    rmSync(installPath, { recursive: true, force: true });
  }
});

test('e2e: real npm install of a nonexistent package is categorized as package_not_found', () => {
  const installPath = mkdtempSync(join(tmpdir(), 'scopewatch-e2e-'));
  const packageName = '@scopewatch/this-package-definitely-does-not-exist-anywhere-xyz123';

  try {
    let stderr = '';
    let code = 0;
    try {
      execFileSync('npm', ['install', packageName, '--prefix', installPath], { encoding: 'utf-8' });
    } catch (err: any) {
      code = typeof err.status === 'number' ? err.status : 1;
      stderr = err.stderr?.toString() ?? String(err.message ?? err);
    }

    strictEqual(code === 0, false, 'installing a nonexistent package must fail against the real registry');

    const error = categorizeNpmFailure(packageName, stderr, installPath);
    strictEqual(
      error.category,
      'package_not_found',
      `Expected package_not_found against the REAL registry, got category: ${error.category}. Raw stderr: ${stderr}`
    );
  } finally {
    rmSync(installPath, { recursive: true, force: true });
  }
});
