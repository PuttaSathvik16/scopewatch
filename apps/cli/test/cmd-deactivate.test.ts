import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { activateForClient, claudeCodeConfigPath, CLAUDE_CODE_CLIENT_ID } from '@scopewatch/client-adapters';
import * as cmds from '../src/commands.js';

/**
 * Section 19 acceptance bullet 7 ("deactivate/uninstall never silently
 * removes unrelated user configuration") was proven at the underlying
 * deactivateForClient level (Phase F) but cmdDeactivate itself - what
 * main.ts's 'scopewatch deactivate' command actually calls - had no direct
 * test and wasn't even wired into the CLI until this pass. Closing both
 * gaps: real activation, a real human-added unrelated entry in the same
 * file, then cmdDeactivate through the actual command function.
 */
test('cmdDeactivate: removes only the Scopewatch-owned entry, a real unrelated human entry survives untouched', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-cmddeactivate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const server_id = 'deactivate-cli-test-server';

  try {
    const manifestId = insertManifest(db, server_id, '1.0.0', 'npm', server_id, 'sha256:v1', '{}');
    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition(server_id, CLAUDE_CODE_CLIENT_ID, from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }
    activateForClient(db, server_id, CLAUDE_CODE_CLIENT_ID, projectRoot);

    const configPath = claudeCodeConfigPath(projectRoot);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.mcpServers['a-real-unrelated-human-tool'] = { command: 'python', args: ['their_script.py'] };
    writeFileSync(configPath, JSON.stringify(config));

    // The actual function under test: cmdDeactivate, exactly as main.ts's 'deactivate' command calls it
    const result = cmds.cmdDeactivate(server_id, CLAUDE_CODE_CLIENT_ID, { db, projectRoot });
    ok(result.ok);

    const finalConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    strictEqual(finalConfig.mcpServers[server_id], undefined, 'the deactivated server entry must be gone');
    deepStrictEqual(
      finalConfig.mcpServers['a-real-unrelated-human-tool'],
      { command: 'python', args: ['their_script.py'] },
      'a real, unrelated human-added entry in the same file must survive deactivation completely untouched'
    );
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
