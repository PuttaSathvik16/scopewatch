import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { checkPrerequisites, satisfiesMinVersion } from '../src/prerequisites.js';
import type { CommandRunner } from '../src/prerequisites.js';

// All tests here use an injected CommandRunner - no real process is spawned,
// so this file makes zero network or subprocess calls and runs fully offline.

test('satisfiesMinVersion: exact minimum satisfies', () => {
  ok(satisfiesMinVersion('22.0.0', '22.0.0'));
});

test('satisfiesMinVersion: higher major satisfies', () => {
  ok(satisfiesMinVersion('24.3.1', '22.0.0'));
});

test('satisfiesMinVersion: lower major does not satisfy', () => {
  strictEqual(satisfiesMinVersion('18.19.0', '22.0.0'), false);
});

test('satisfiesMinVersion: same major, higher minor satisfies', () => {
  ok(satisfiesMinVersion('22.5.0', '22.0.0'));
});

test('satisfiesMinVersion: same major.minor, lower patch does not satisfy', () => {
  strictEqual(satisfiesMinVersion('22.0.0', '22.0.5'), false);
});

test('checkPrerequisites: Node not installed (ENOENT) -> node_not_installed category with actionable message', () => {
  const runner: CommandRunner = (command) => {
    if (command === 'node') {
      const err: any = new Error('spawn node ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    throw new Error('should not reach npm check');
  };

  const result = checkPrerequisites(runner);
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'node_not_installed');
    ok(
      result.error.message.includes('Node.js is not installed or not on PATH'),
      `Expected actionable Node-not-installed message, got: "${result.error.message}"`
    );
    ok(result.error.message.includes('nodejs.org'), 'message should point to where to get Node.js');
  }
});

test('checkPrerequisites: Node version too old -> node_version_too_old category naming the found version and the floor', () => {
  const runner: CommandRunner = (command) => {
    if (command === 'node') return 'v18.19.0\n';
    throw new Error('should not reach npm check');
  };

  const result = checkPrerequisites(runner);
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'node_version_too_old');
    ok(
      result.error.message.includes('18.19.0') && result.error.message.includes('22.0.0'),
      `Message should name both the found version and the required minimum. Got: "${result.error.message}"`
    );
  }
});

test('checkPrerequisites: npm not installed -> npm_not_installed category with actionable message', () => {
  const runner: CommandRunner = (command) => {
    if (command === 'node') return 'v22.5.0\n';
    if (command === 'npm') {
      const err: any = new Error('spawn npm ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    throw new Error('unexpected command');
  };

  const result = checkPrerequisites(runner);
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'npm_not_installed');
    ok(
      result.error.message.includes('npm is not installed or not on PATH'),
      `Expected actionable npm-not-installed message, got: "${result.error.message}"`
    );
  }
});

test('checkPrerequisites: both Node and npm present and valid -> ok result with parsed versions', () => {
  const runner: CommandRunner = (command) => {
    if (command === 'node') return 'v22.5.0\n';
    if (command === 'npm') return '10.8.2\n';
    throw new Error('unexpected command');
  };

  const result = checkPrerequisites(runner);
  strictEqual(result.ok, true);
  if (result.ok) {
    strictEqual(result.nodeVersion, '22.5.0');
    strictEqual(result.npmVersion, '10.8.2');
  }
});

test('checkPrerequisites: exactly at the minimum Node version passes', () => {
  const runner: CommandRunner = (command) => {
    if (command === 'node') return 'v22.0.0\n';
    if (command === 'npm') return '10.0.0\n';
    throw new Error('unexpected command');
  };

  const result = checkPrerequisites(runner);
  strictEqual(result.ok, true);
});
