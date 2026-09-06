import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { searchServers, getServerInfo } from '../src/registry-client.js';
import type { FetchFn } from '../src/registry-client.js';

// All tests offline - fetch is always injected, never real.

test('searchServers: network failure -> network_unreachable category with actionable message', async () => {
  const fetchFn: FetchFn = (async () => {
    throw new TypeError('fetch failed: ENOTFOUND registry.modelcontextprotocol.io');
  }) as FetchFn;

  const result = await searchServers('test', fetchFn);
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'network_unreachable');
    ok(result.error.message.includes('internet connection'));
  }
});

test('getServerInfo: 404 -> server_not_found category naming the server', async () => {
  const fetchFn: FetchFn = (async () => new Response('not found', { status: 404 })) as FetchFn;

  const result = await getServerInfo('does.not/exist', fetchFn);
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'server_not_found');
  }
});

test('getServerInfo: 500 -> registry_error category, not a raw crash', async () => {
  const fetchFn: FetchFn = (async () => new Response('internal error', { status: 500 })) as FetchFn;

  const result = await getServerInfo('some-server', fetchFn);
  strictEqual(result.ok, false);
  if (!result.ok) {
    strictEqual(result.error.category, 'registry_error');
    ok(result.error.message.includes('temporary'));
  }
});

test('getServerInfo: URL-encodes the server name (reverse-DNS names contain "/")', async () => {
  let capturedUrl = '';
  const fetchFn: FetchFn = (async (url: string | URL) => {
    capturedUrl = url.toString();
    return new Response(JSON.stringify({ server: { name: 'a/b', description: 'x', version: '1.0.0' } }), { status: 200 });
  }) as FetchFn;

  await getServerInfo('io.github.test/my-server', fetchFn);
  ok(capturedUrl.includes('io.github.test%2Fmy-server'), `Expected URL-encoded name in request. Got: ${capturedUrl}`);
});

test('searchServers: successful search returns real-shaped server list', async () => {
  const fetchFn: FetchFn = (async () =>
    new Response(
      JSON.stringify({
        servers: [{ server: { name: 'a/b', description: 'test server', version: '1.0.0' } }],
        metadata: { count: 1, nextCursor: 'a/b:1.0.0' },
      }),
      { status: 200 }
    )) as FetchFn;

  const result = await searchServers('test', fetchFn);
  strictEqual(result.ok, true);
  if (result.ok) {
    strictEqual(result.result.servers.length, 1);
    strictEqual(result.result.servers[0]!.name, 'a/b');
    strictEqual(result.result.nextCursor, 'a/b:1.0.0');
  }
});
