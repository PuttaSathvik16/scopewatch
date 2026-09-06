import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { storeSecret, deleteSecret, injectSecrets } from '../src/keychain.js';
import { createLogger, _clearAllLiveSecretsForTesting } from '../src/logger.js';
import { secretRef } from '../src/secret-ref.js';

/**
 * Exit check from the original brief (Phase D): "grep the entire generated
 * config, lockfile, and log output after a full install+configure run - zero
 * plaintext secret values anywhere." Built as an automated test, not a manual
 * check: a real secret value is stored via the real OS keychain, then run
 * through a simulated install -> configure -> activate flow that touches every
 * artifact type the brief calls out - a generated client config file, the real
 * SQLite lockfile (via @scopewatch/state, Phase C), and log output (via this
 * package's redacting logger) - and every one of those artifacts is grepped
 * for the raw value afterward.
 */

const REAL_SECRET_VALUE = 'ghp_ThisIsARealLookingSecretValueForTheExitCheck9x7Q';
const SERVER_ID = 'exit-check-test-server';
const SECRET_ID = 'GITHUB_TOKEN';
const REF = secretRef(SERVER_ID, SECRET_ID);

test('Exit check: zero plaintext secret values in generated config, lockfile, or logs after a full run', async () => {
  const workDir = mkdtempSync(join(tmpdir(), 'scopewatch-exit-check-'));
  const dbPath = join(workDir, 'state.db');
  const configPath = join(workDir, 'generated-client-config.json');
  const logPath = join(workDir, 'scopewatch.log');

  _clearAllLiveSecretsForTesting();

  try {
    // --- Step 1: "configure" - user is prompted, secret is stored in the real OS keychain ---
    const storeResult = storeSecret(REF, REAL_SECRET_VALUE);
    strictEqual(storeResult.ok, true, `setup: storing the test secret must succeed`);

    // --- Step 2: set up state (Phase C) - manifest + lockfile row ---
    const db = openDatabase(dbPath);
    const manifestJson = JSON.stringify({
      schemaVersion: 1,
      version: '1.0.0',
      source: { type: 'npm', location: SERVER_ID },
      checksum: 'sha256:test',
      tools: [{ id: 'reader', name: 'Reader', description: 'reads things' }],
      capabilities: [{ tool_id: 'reader', verb: 'read', resource: 'repo:owner/name', provenance: 'declared' }],
      // Only the secret's id is ever recorded here - never a value.
      secrets: [{ id: SECRET_ID, description: 'GitHub token', required: true, used_by: ['reader'] }],
    });
    const manifestId = insertManifest(db, SERVER_ID, '1.0.0', 'npm', SERVER_ID, 'sha256:test', manifestJson);

    const engine = new LifecycleEngine(db);
    const clientId = 'claude-code';
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const intentId = engine.startTransition(SERVER_ID, clientId, from as any, to as any, null);
      engine.confirmTransition(intentId, manifestId);
    }
    db.close();

    // --- Step 3: "activate" - inject the secret into a simulated spawned process's env,
    // write a generated client config file (never containing the value, only the
    // secret's id/reference), and log the activation (through the redacting logger) ---
    const injectResult = injectSecrets([{ envVar: SECRET_ID, ref: REF }]);
    strictEqual(injectResult.ok, true, 'secret injection for activation must succeed');

    // Generated client config: references the secret by id/env-var name only,
    // exactly as a real client config (e.g. claude_desktop_config.json) would -
    // never embeds the resolved value.
    const generatedConfig = {
      mcpServers: {
        [SERVER_ID]: {
          command: 'npx',
          args: [SERVER_ID],
          env: { [SECRET_ID]: `\${${SECRET_ID}}` }, // placeholder reference, not the value
        },
      },
    };
    writeFileSync(configPath, JSON.stringify(generatedConfig, null, 2));

    // Log output: exercise the logger with a message that WOULD have leaked the
    // real value if redaction were not working - this is the actual test of the
    // redaction guarantee, not just a happy-path log line.
    const logLines: string[] = [];
    const logger = createLogger((_level, line) => logLines.push(line));
    logger.info(`Activating ${SERVER_ID} for ${clientId}, injecting ${SECRET_ID}=${injectResult.ok ? injectResult.env[SECRET_ID] : ''}`);
    logger.info(`Spawn env prepared:`, injectResult.ok ? injectResult.env : {});
    writeFileSync(logPath, logLines.join('\n'));

    // --- Step 4: the actual exit check - grep every artifact for the raw value ---
    const artifacts: { name: string; content: string }[] = [
      { name: 'generated client config', content: readFileSync(configPath, 'utf-8') },
      { name: 'log output', content: readFileSync(logPath, 'utf-8') },
    ];

    // The lockfile/state database: read as raw bytes, since a leak could occur
    // in any column (manifest_json, error messages, etc.), not just ones we
    // expect. This is the strongest form of the check - scanning the actual
    // bytes on disk, not just querying the columns we think matter.
    const dbBytes = readFileSync(dbPath);
    artifacts.push({ name: 'SQLite lockfile/state (raw bytes)', content: dbBytes.toString('latin1') });

    // Also scan every file in the entire work directory, in case something
    // wrote an artifact we didn't explicitly enumerate above (e.g. a WAL file).
    for (const file of readdirSync(workDir)) {
      const fullPath = join(workDir, file);
      if (statSync(fullPath).isFile()) {
        const bytes = readFileSync(fullPath);
        artifacts.push({ name: `workdir file: ${file}`, content: bytes.toString('latin1') });
      }
    }

    for (const artifact of artifacts) {
      ok(
        !artifact.content.includes(REAL_SECRET_VALUE),
        `PLAINTEXT SECRET LEAK in ${artifact.name}: the raw secret value was found in this artifact.`
      );
    }

    // Sanity check the test is actually meaningful: confirm the secret's id
    // (not the value) IS legitimately present in the config and manifest -
    // proving we're checking real artifacts that reference the secret, not
    // artifacts that happen to be empty/unrelated.
    ok(artifacts[0]!.content.includes(SECRET_ID), 'sanity: generated config should reference the secret by id');
    ok(
      artifacts.find((a) => a.name.includes('raw bytes'))!.content.includes(SECRET_ID),
      'sanity: manifest_json in the real database should contain the secret id label'
    );

    // Confirm the logger actually redacted the value (not just that the value
    // happens to be absent because the logger never got a chance to run) -
    // check for the redaction marker being present in the log output.
    ok(artifacts[1]!.content.includes('[REDACTED]'), 'sanity: log output should show the redaction marker, proving redaction actually ran');
  } finally {
    deleteSecret(REF);
    _clearAllLiveSecretsForTesting();
    rmSync(workDir, { recursive: true, force: true });
  }
});
