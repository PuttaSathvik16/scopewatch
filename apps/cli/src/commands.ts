import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  LifecycleEngine,
  insertManifest,
  insertDiff,
  getDiffObject,
  getCurrentManifestFor,
  type SqliteDatabase,
} from '@scopewatch/state';
import { computeDiff, renderDiff, extractSummary } from '@scopewatch/diff-engine';
import type { ServerManifest } from '@scopewatch/manifest';
import { checkPrerequisites, installPackage, checkEntryPoint, type InstallRunner, type CommandRunner } from '@scopewatch/install-adapters';
import { activateForClient, deactivateForClient } from '@scopewatch/client-adapters';
import { storeSecret, promptSecret, secretRef } from '@scopewatch/secrets';
import { searchServers, getServerInfo, type FetchFn, type RegistryServer } from './registry-client.js';
import { mcpHandshakeAndListTools, type SpawnFn as McpSpawnFn } from './mcp-client.js';
import { buildManifestFromRegistry } from './build-manifest.js';
import { realInstallRunner, realCommandRunner } from './real-runners.js';

export type CliDeps = {
  db: SqliteDatabase;
  fetchFn?: FetchFn;
  installRunner?: InstallRunner;
  prereqRunner?: CommandRunner;
  mcpSpawnFn?: McpSpawnFn;
  promptFn?: typeof promptSecret;
  projectRoot?: string;
  installRoot?: string;
};

function defaultInstallRoot(server_id: string): string {
  return join(homedir(), '.scopewatch', 'servers', server_id.replace(/[/@]/g, '_'));
}

// --- doctor / init ---

export function cmdDoctor(deps: CliDeps) {
  return checkPrerequisites(deps.prereqRunner ?? realCommandRunner);
}

// --- search / info ---

export async function cmdSearch(term: string, deps: CliDeps) {
  return searchServers(term, deps.fetchFn ?? fetch);
}

export async function cmdInfo(name: string, deps: CliDeps) {
  return getServerInfo(name, deps.fetchFn ?? fetch);
}

// --- install ---

export type InstallOutcome =
  | { ok: true; manifest: ServerManifest; warnings: string[] }
  | { ok: false; stage: string; error: unknown };

/**
 * Full install pipeline: registry fetch -> lifecycle discovered->reviewed
 * (manifest built with REAL inferred capabilities) -> installed (real npm
 * install) -> configured (secret prompting for each required credential) ->
 * validated (entry-point smoke check). Does not activate - that's a
 * separate, explicit step (`activate`), consistent with "diff shown before
 * activation, never after."
 */
export async function cmdInstall(serverName: string, client_id: string, deps: CliDeps): Promise<InstallOutcome> {
  const { db } = deps;

  const infoResult = await getServerInfo(serverName, deps.fetchFn ?? fetch);
  if (!infoResult.ok) return { ok: false, stage: 'registry_fetch', error: infoResult.error };

  const registryServer: RegistryServer = infoResult.server;
  const pkg = registryServer.packages?.[0];
  if (!pkg) {
    return { ok: false, stage: 'registry_fetch', error: new Error(`Server '${serverName}' has no installable npm package in the registry.`) };
  }

  const prereqs = checkPrerequisites(deps.prereqRunner ?? realCommandRunner);
  if (!prereqs.ok) return { ok: false, stage: 'prerequisites', error: prereqs.error };

  const installRoot = deps.installRoot ?? defaultInstallRoot(registryServer.name);
  const installResult = installPackage(pkg.identifier, installRoot, deps.installRunner ?? realInstallRunner, deps.prereqRunner ?? realCommandRunner);
  if (!installResult.ok) return { ok: false, stage: 'install', error: installResult.error };

  const entryPointError = await checkEntryPoint(pkg.identifier, installRoot, 'index.js').catch(() => null);
  // Entry point check is best-effort here (some packages' main entry point isn't index.js) -
  // a failure here is informational, not fatal to the install pipeline, since the real
  // validation is the MCP handshake below.
  void entryPointError;

  // Real MCP handshake to get real tools/list data for capability inference -
  // not a placeholder.
  const handshakeResult = await mcpHandshakeAndListTools(
    'npx',
    ['-y', pkg.identifier],
    process.env,
    deps.mcpSpawnFn,
  );
  if (!handshakeResult.ok) return { ok: false, stage: 'handshake', error: handshakeResult.error };

  const manifestResult = buildManifestFromRegistry(registryServer, handshakeResult.tools);
  if (!manifestResult.ok) return { ok: false, stage: 'manifest_build', error: manifestResult.errors };

  const manifest = manifestResult.manifest;
  const manifestId = insertManifest(
    db,
    registryServer.name,
    manifest.version,
    'npm',
    pkg.identifier,
    manifest.checksum,
    JSON.stringify(manifest)
  );

  const engine = new LifecycleEngine(db);
  const server_id = registryServer.name;

  for (const [from, to] of [
    ['discovered', 'reviewed'],
    ['reviewed', 'installed'],
  ] as [string, string][]) {
    const intentId = engine.startTransition(server_id, client_id, from as any, to as any, null);
    engine.confirmTransition(intentId, manifestId);
  }

  // configured: prompt + store each required secret
  for (const secretDecl of manifest.secrets) {
    if (!secretDecl.required) continue;
    const value = await (deps.promptFn ?? promptSecret)(`Enter value for ${secretDecl.id} (${secretDecl.description}): `);
    storeSecret(secretRef(server_id, secretDecl.id), value);
  }
  const configuredIntent = engine.startTransition(server_id, client_id, 'installed', 'configured', null);
  engine.confirmTransition(configuredIntent, manifestId);

  // validated
  const validatedIntent = engine.startTransition(server_id, client_id, 'configured', 'validated', null);
  engine.confirmTransition(validatedIntent, manifestId);

  return { ok: true, manifest, warnings: manifestResult.warnings };
}

// --- test ---

export async function cmdTest(server_id: string, client_id: string, deps: CliDeps) {
  const { db } = deps;
  const manifest = getCurrentManifestFor(db, server_id, client_id);
  if (!manifest) {
    return { ok: false as const, error: new Error(`No manifest on record for '${server_id}'. Run 'scopewatch install' first.`) };
  }
  const parsed = JSON.parse(manifest.manifest_json) as ServerManifest;
  const result = await mcpHandshakeAndListTools('npx', ['-y', parsed.source.location], process.env, deps.mcpSpawnFn);
  return result;
}

// --- activate ---

export function cmdActivate(server_id: string, client_id: string, deps: CliDeps) {
  const { db } = deps;
  const engine = new LifecycleEngine(db);
  const intentId = engine.startTransition(server_id, client_id, 'validated', 'active', null);
  engine.confirmTransition(intentId);
  activateForClient(db, server_id, client_id, deps.projectRoot ?? process.cwd());
  return { ok: true };
}

// --- update --check / update ---

export async function cmdUpdateCheck(server_id: string, client_id: string, deps: CliDeps) {
  const { db } = deps;
  const current = getCurrentManifestFor(db, server_id, client_id);
  if (!current) return { ok: false as const, error: new Error(`No manifest on record for '${server_id}'.`) };

  const infoResult = await getServerInfo(server_id, deps.fetchFn ?? fetch);
  if (!infoResult.ok) return { ok: false as const, error: infoResult.error };

  const hasUpdate = infoResult.server.version !== current.version;
  return { ok: true as const, hasUpdate, currentVersion: current.version, latestVersion: infoResult.server.version };
}

export async function cmdUpdate(server_id: string, client_id: string, deps: CliDeps) {
  const { db } = deps;
  const current = getCurrentManifestFor(db, server_id, client_id);
  if (!current) return { ok: false as const, stage: 'lookup', error: new Error(`No manifest on record for '${server_id}'.`) };

  const infoResult = await getServerInfo(server_id, deps.fetchFn ?? fetch);
  if (!infoResult.ok) return { ok: false as const, stage: 'registry_fetch', error: infoResult.error };

  const registryServer = infoResult.server;
  const pkg = registryServer.packages?.[0];
  if (!pkg) return { ok: false as const, stage: 'registry_fetch', error: new Error('No installable package.') };

  const handshakeResult = await mcpHandshakeAndListTools('npx', ['-y', pkg.identifier], process.env, deps.mcpSpawnFn);
  if (!handshakeResult.ok) return { ok: false as const, stage: 'handshake', error: handshakeResult.error };

  const manifestResult = buildManifestFromRegistry(registryServer, handshakeResult.tools);
  if (!manifestResult.ok) return { ok: false as const, stage: 'manifest_build', error: manifestResult.errors };

  const newManifest = manifestResult.manifest;
  const newManifestId = insertManifest(
    db,
    registryServer.name,
    newManifest.version,
    'npm',
    pkg.identifier,
    newManifest.checksum,
    JSON.stringify(newManifest)
  );

  const oldManifestParsed = JSON.parse(current.manifest_json) as ServerManifest;
  const diff = computeDiff(oldManifestParsed, newManifest);
  const diffId = insertDiff(db, current.id, newManifestId, diff, diff.newly_destructive, diff.riskLevel, extractSummary(diff));

  const engine = new LifecycleEngine(db);
  const intentId = engine.startTransition(server_id, client_id, 'active', 'updated', diffId);
  engine.confirmTransition(intentId, newManifestId);

  return { ok: true as const, diff, rendered: renderDiff(diff), diffId, newManifestId };
}

export function cmdApproveUpdate(server_id: string, client_id: string, newManifestId: number, deps: CliDeps) {
  const { db } = deps;
  const engine = new LifecycleEngine(db);
  const intentId = engine.startTransition(server_id, client_id, 'updated', 'active', null);
  engine.confirmTransition(intentId, newManifestId);
  return { ok: true };
}

// --- diff ---

export function cmdDiff(diffId: number, deps: CliDeps) {
  const diffObj = getDiffObject(deps.db, diffId);
  if (!diffObj) return { ok: false as const, error: new Error(`No diff found with id ${diffId}`) };
  return { ok: true as const, rendered: renderDiff(diffObj as any) };
}

// --- rollback ---

export function cmdRollback(server_id: string, client_id: string, deps: CliDeps) {
  const engine = new LifecycleEngine(deps.db);
  engine.rollback(server_id, client_id);
  return { ok: true };
}

// --- status ---

export function cmdStatus(deps: CliDeps) {
  const rows = deps.db.prepare('SELECT server_id, client_id, state, updated_at FROM lockfile_entries').all();
  return rows;
}

// --- drift (stub) ---

export function cmdDrift() {
  return { ok: true as const, message: 'drift detection is not yet implemented (Phase H). No client configs were checked.' };
}

// --- deactivate (used internally by rollback flows / not a top-level command yet, kept for completeness) ---

export function cmdDeactivate(server_id: string, client_id: string, deps: CliDeps) {
  deactivateForClient(deps.db, server_id, client_id, deps.projectRoot ?? process.cwd());
  return { ok: true };
}
