/**
 * The single code path allowed to construct a keychain account reference.
 * Composite (server_id:secret_id) because the same secret id (e.g. "GITHUB_TOKEN")
 * could otherwise collide across two unrelated servers that happen to name their
 * secret the same thing. Store, retrieve, and delete must all go through this -
 * never construct the string inline elsewhere, or store-time and lookup-time
 * keys can silently drift apart.
 */
export function secretRef(server_id: string, secret_id: string): string {
  return `${server_id}:${secret_id}`;
}

export const KEYCHAIN_SERVICE_NAME = 'scopewatch';
