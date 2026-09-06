import { inferCapabilities } from '@scopewatch/capability-inference';
import type { McpTool } from '@scopewatch/capability-inference';
import { parseManifest } from '@scopewatch/manifest';
import type { ServerManifest } from '@scopewatch/manifest';
import type { RegistryServer } from './registry-client.js';
import type { McpToolResult } from './mcp-client.js';

/**
 * Builds a ServerManifest from real registry metadata (secrets, source) and
 * real inferred capabilities (from an actual tools/list call against the
 * installed server) - not a placeholder. Any warnings from inference are
 * returned alongside the manifest for the caller to surface.
 */
export function buildManifestFromRegistry(
  registryServer: RegistryServer,
  tools: McpToolResult[]
): { ok: true; manifest: ServerManifest; warnings: string[] } | { ok: false; errors: unknown } {
  const pkg = registryServer.packages?.[0];

  const inference = inferCapabilities(registryServer.name, tools as McpTool[]);

  const raw = {
    schemaVersion: 1,
    version: registryServer.version,
    source: {
      type: pkg ? 'npm' : 'git',
      location: pkg?.identifier ?? registryServer.repository?.url ?? registryServer.name,
    },
    checksum: `sha256:unknown-${registryServer.version}`, // real checksum verification is Phase E's install adapter's job at install time
    tools: tools.map((t) => ({ id: t.name, name: t.name, description: t.description })),
    capabilities: inference.capabilities,
    secrets: (pkg?.environmentVariables ?? []).map((ev) => ({
      id: ev.name,
      description: ev.description && ev.description.length > 0 ? ev.description : `Environment variable required by ${registryServer.name}`,
      required: ev.isRequired ?? false,
      used_by: tools.map((t) => t.name), // registry data doesn't say which tool uses which secret; conservatively attribute to all
    })),
    metadata: registryServer.repository ? { homepage: registryServer.repository.url } : undefined,
  };

  const result = parseManifest(raw);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  return { ok: true, manifest: result.value, warnings: inference.warnings };
}
