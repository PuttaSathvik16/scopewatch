import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { minimalSpawnEnv } from '../src/minimal-env.js';

test('minimalSpawnEnv: does NOT include an unrelated variable from process.env', () => {
  const sentinelKey = 'SCOPEWATCH_TEST_UNRELATED_SECRET';
  process.env[sentinelKey] = 'should-never-be-copied';

  try {
    const env = minimalSpawnEnv();
    ok(
      !(sentinelKey in env),
      `minimalSpawnEnv must not copy arbitrary ambient environment variables. Found: ${JSON.stringify(env)}`
    );
  } finally {
    delete process.env[sentinelKey];
  }
});

test('minimalSpawnEnv: includes PATH (the actual fix needed for npx/node resolution)', () => {
  const env = minimalSpawnEnv();
  ok(env.PATH, 'PATH must be present so npx/node can be resolved');
  strictEqual(env.PATH, process.env.PATH);
});

test('minimalSpawnEnv: includes only PATH plus platform-baseline vars, nothing else from process.env', () => {
  const env = minimalSpawnEnv();
  const allowedKeys =
    process.platform === 'win32'
      ? new Set(['PATH', 'PATHEXT', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP', 'APPDATA'])
      : new Set(['PATH', 'HOME', 'TMPDIR']);

  for (const key of Object.keys(env)) {
    ok(allowedKeys.has(key), `Unexpected key '${key}' in minimal env - only ${[...allowedKeys].join(', ')} are allowed`);
  }
});

test('minimalSpawnEnv: injects ONLY the specific secrets passed in, nothing from process.env', () => {
  process.env['UNRELATED_API_KEY'] = 'unrelated-value-that-must-not-leak';

  try {
    const env = minimalSpawnEnv({ MY_SERVER_TOKEN: 'the-actual-secret-value' });
    strictEqual(env.MY_SERVER_TOKEN, 'the-actual-secret-value', 'the explicitly passed secret must be present');
    ok(!('UNRELATED_API_KEY' in env), 'an unrelated real environment variable must never leak into the spawn env');
  } finally {
    delete process.env['UNRELATED_API_KEY'];
  }
});

test('minimalSpawnEnv: with no secrets passed, env is exactly the baseline set (no extras)', () => {
  const env = minimalSpawnEnv();
  const withSecret = minimalSpawnEnv({ X: 'y' });
  const { X, ...rest } = withSecret;
  deepStrictEqual(rest, env, 'adding a secret should only add that key, nothing else should change');
});
