import { networkUnreachableError, registryErrorResponse, serverNotFoundError } from './registry-errors.js';
import type { RegistryError } from './registry-errors.js';

// Respects SCOPEWATCH_REGISTRY_URL when set - lets a real-subprocess
// integration test point the real compiled binary at a local fixture
// registry instead of the real network, without any code-level injection
// (which isn't possible across a process boundary). Off by default.
const REGISTRY_BASE_URL = process.env.SCOPEWATCH_REGISTRY_URL ?? 'https://registry.modelcontextprotocol.io';

export type RegistryPackage = {
  registryType: string;
  identifier: string;
  version: string;
  transport?: { type: string };
  environmentVariables?: {
    name: string;
    description?: string;
    isRequired?: boolean;
    isSecret?: boolean;
    default?: string;
  }[];
};

export type RegistryServer = {
  name: string;
  description: string;
  title?: string;
  version: string;
  repository?: { url: string; source: string };
  packages?: RegistryPackage[];
  remotes?: { type: string; url: string }[];
};

export type RegistrySearchResult = { servers: RegistryServer[]; nextCursor: string | undefined };

/** Injectable for testability - avoids real network calls in unit tests. */
export type FetchFn = typeof fetch;

async function doFetch(url: string, fetchFn: FetchFn): Promise<{ ok: true; data: any } | { ok: false; error: RegistryError }> {
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (err: any) {
    return { ok: false, error: networkUnreachableError(String(err?.message ?? err)) };
  }

  if (response.status === 404) {
    return { ok: false, error: serverNotFoundError(url) };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, error: registryErrorResponse(response.status, text) };
  }

  try {
    const data = await response.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: registryErrorResponse(response.status, `malformed JSON response: ${err?.message}`) };
  }
}

export async function searchServers(
  term: string,
  fetchFn: FetchFn = fetch,
  limit = 10
): Promise<{ ok: true; result: RegistrySearchResult } | { ok: false; error: RegistryError }> {
  const url = `${REGISTRY_BASE_URL}/v0.1/servers?search=${encodeURIComponent(term)}&limit=${limit}`;
  const result = await doFetch(url, fetchFn);
  if (!result.ok) return result;

  const servers: RegistryServer[] = (result.data.servers ?? []).map((entry: any) => entry.server);
  return { ok: true, result: { servers, nextCursor: result.data.metadata?.nextCursor } };
}

export async function getServerInfo(
  name: string,
  fetchFn: FetchFn = fetch,
  version = 'latest'
): Promise<{ ok: true; server: RegistryServer } | { ok: false; error: RegistryError }> {
  const encodedName = encodeURIComponent(name);
  const url = `${REGISTRY_BASE_URL}/v0.1/servers/${encodedName}/versions/${version}`;
  const result = await doFetch(url, fetchFn);
  if (!result.ok) return result;

  if (!result.data.server) {
    return { ok: false, error: serverNotFoundError(name) };
  }
  return { ok: true, server: result.data.server as RegistryServer };
}
