import { test } from 'node:test';
import { strictEqual, notStrictEqual } from 'node:assert';
import { secretRef } from '../src/secret-ref.js';

test('secretRef: composite reference joins server_id and secret_id', () => {
  strictEqual(secretRef('@modelcontextprotocol/server-github', 'GITHUB_TOKEN'), '@modelcontextprotocol/server-github:GITHUB_TOKEN');
});

test('secretRef: same secret_id under different servers does not collide', () => {
  const ref1 = secretRef('server-a', 'API_TOKEN');
  const ref2 = secretRef('server-b', 'API_TOKEN');
  notStrictEqual(ref1, ref2);
});
