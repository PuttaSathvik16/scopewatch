import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorizeNpmFailure, checkEntryPoint, installPackage } from '../src/npm-adapter.js';
import type { InstallRunner } from '../src/npm-adapter.js';
import type { CommandRunner } from '../src/prerequisites.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

// All tests in this file use injected runners and local fixture files/text -
// no real network call or real npm process is made anywhere here.

test('categorizeNpmFailure: E404 -> package_not_found, names the package', () => {
  const stderr = loadFixture('e404.txt');
  const error = categorizeNpmFailure('@scopewatch/definitely-does-not-exist-xyz', stderr, '/tmp/install');

  strictEqual(error.category, 'package_not_found');
  ok(
    error.message.includes('@scopewatch/definitely-does-not-exist-xyz') &&
      error.message.includes('was not found in the npm registry'),
    `Expected package-not-found message naming the package. Got: "${error.message}"`
  );
});

test('categorizeNpmFailure: ETARGET -> package_not_found', () => {
  const stderr = loadFixture('etarget.txt');
  const error = categorizeNpmFailure('some-package', stderr, '/tmp/install');

  strictEqual(error.category, 'package_not_found');
});

test('categorizeNpmFailure: ENOTFOUND -> network_unreachable', () => {
  const stderr = loadFixture('enotfound.txt');
  const error = categorizeNpmFailure('some-package', stderr, '/tmp/install');

  strictEqual(error.category, 'network_unreachable');
  ok(
    error.message.includes('Could not reach the npm registry') && error.message.includes('network'),
    `Expected network-unreachable message. Got: "${error.message}"`
  );
});

test('categorizeNpmFailure: ETIMEDOUT -> network_unreachable', () => {
  const stderr = loadFixture('etimedout.txt');
  const error = categorizeNpmFailure('some-package', stderr, '/tmp/install');

  strictEqual(error.category, 'network_unreachable');
});

test('categorizeNpmFailure: EACCES -> permission_denied, names the install path', () => {
  const stderr = loadFixture('eacces.txt');
  const error = categorizeNpmFailure('some-package', stderr, '/usr/lib/node_modules');

  strictEqual(error.category, 'permission_denied');
  ok(
    error.message.includes('/usr/lib/node_modules') && error.message.includes('Permission denied'),
    `Expected permission-denied message naming the path. Got: "${error.message}"`
  );
});

test('categorizeNpmFailure: unrecognized npm error code -> unrecognized category, not a crash', () => {
  const stderr = loadFixture('unrecognized.txt');
  const error = categorizeNpmFailure('some-package', stderr, '/tmp/install');

  strictEqual(error.category, 'unrecognized');
  ok(
    error.message.includes('EBADPLATFORM') && error.message.includes('unrecognized'),
    `Expected unrecognized-category message naming the actual code. Got: "${error.message}"`
  );
  // Even the fallback category is a structured InstallError, not a raw exception
  ok(error.detail, 'unrecognized errors still retain raw detail for diagnostics');
});

test('checkEntryPoint: missing entry file on disk -> entry_point_broken', async () => {
  const installRoot = join(fixturesDir, 'fake-install-root');
  const error = await checkEntryPoint('nonexistent-package', installRoot, 'index.js');

  ok(error, 'should return an error for a missing entry point');
  strictEqual(error!.category, 'entry_point_broken');
  ok(error!.message.includes('entry point failed a basic load check'), `Got: "${error!.message}"`);
});

test('checkEntryPoint: entry file exists but throws on import -> entry_point_broken with underlying detail', async () => {
  const installRoot = join(fixturesDir, 'fake-install-root');
  const error = await checkEntryPoint('broken-package', installRoot, 'index.js');

  ok(error, 'should return an error when the entry point throws on load');
  strictEqual(error!.category, 'entry_point_broken');
  ok(
    error!.message.includes('missing runtime dependency during module load'),
    `Expected the underlying throw message to surface. Got: "${error!.message}"`
  );
});

test('checkEntryPoint: entry file exists and imports cleanly -> no error', async () => {
  const installRoot = join(fixturesDir, 'fake-install-root');
  const error = await checkEntryPoint('working-package', installRoot, 'index.js');

  strictEqual(error, null, 'a working entry point should produce no error');
});

test('installPackage: prerequisite failure short-circuits before npm is ever invoked', () => {
  const prereqRunner: CommandRunner = () => {
    const err: any = new Error('spawn node ENOENT');
    err.code = 'ENOENT';
    throw err;
  };

  let npmWasCalled = false;
  const installRunner: InstallRunner = () => {
    npmWasCalled = true;
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = installPackage('some-package', '/tmp/install', installRunner, prereqRunner);

  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'node_not_installed');
  }
  strictEqual(npmWasCalled, false, 'npm install must never run when prerequisites fail');
});

test('installPackage: successful install returns ok with install path', () => {
  const prereqRunner: CommandRunner = (command) => (command === 'node' ? 'v22.5.0\n' : '10.8.2\n');
  const installRunner: InstallRunner = () => ({ code: 0, stdout: 'added 1 package', stderr: '' });

  const result = installPackage('some-package', '/tmp/install', installRunner, prereqRunner);

  strictEqual(result.ok, true);
  if (result.ok) {
    strictEqual(result.installPath, '/tmp/install');
  }
});

test('installPackage: npm failure is categorized, not thrown raw', () => {
  const prereqRunner: CommandRunner = (command) => (command === 'node' ? 'v22.5.0\n' : '10.8.2\n');
  const installRunner: InstallRunner = () => ({
    code: 1,
    stdout: '',
    stderr: loadFixture('e404.txt'),
  });

  const result = installPackage('@scopewatch/nonexistent', '/tmp/install', installRunner, prereqRunner);

  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'package_not_found');
    ok(result.error instanceof Error, 'InstallError is a real Error instance, not a bare object');
  }
});
