import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@scopewatch/state';
import { activateForClient, deactivateForClient, configPathFor } from '../src/activate.js';
import { CLAUDE_CODE_CLIENT_ID, claudeCodeConfigPath } from '../src/claude-code-adapter.js';
import { CURSOR_CLIENT_ID, cursorConfigPath } from '../src/cursor-adapter.js';

test('configPathFor: correct paths for both clients', () => {
  // Found via a real Windows CI run: this test hardcoded POSIX separators
  // while the real functions correctly use path.join (native separators per
  // platform) - a test bug, not a product bug. join() here makes the
  // expectation match whatever the current platform actually produces.
  strictEqual(configPathFor(CLAUDE_CODE_CLIENT_ID, '/my/project'), join('/my/project', '.mcp.json'));
  strictEqual(configPathFor(CURSOR_CLIENT_ID, '/my/project'), join('/my/project', '.cursor', 'mcp.json'));
  strictEqual(claudeCodeConfigPath('/my/project'), join('/my/project', '.mcp.json'));
  strictEqual(cursorConfigPath('/my/project'), join('/my/project', '.cursor', 'mcp.json'));
});

test('activateForClient: creates .mcp.json for Claude Code with the wrapper command', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);

  try {
    activateForClient(db, 'my-server', CLAUDE_CODE_CLIENT_ID, projectRoot);

    const configPath = join(projectRoot, '.mcp.json');
    ok(existsSync(configPath));
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(config.mcpServers['my-server'], { command: 'scopewatch-run', args: ['my-server', 'claude-code'] });
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('activateForClient: creates .cursor/mcp.json for Cursor (nested directory created automatically)', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);

  try {
    activateForClient(db, 'my-server', CURSOR_CLIENT_ID, projectRoot);

    const configPath = join(projectRoot, '.cursor', 'mcp.json');
    ok(existsSync(configPath), '.cursor/ directory should be created automatically');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(config.mcpServers['my-server'], { command: 'scopewatch-run', args: ['my-server', 'cursor'] });
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('activateForClient: the SAME manifest activates correctly for BOTH clients without touching each other\'s files', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);

  try {
    activateForClient(db, 'shared-server', CLAUDE_CODE_CLIENT_ID, projectRoot);
    activateForClient(db, 'shared-server', CURSOR_CLIENT_ID, projectRoot);

    const claudeConfig = JSON.parse(readFileSync(join(projectRoot, '.mcp.json'), 'utf-8'));
    const cursorConfig = JSON.parse(readFileSync(join(projectRoot, '.cursor', 'mcp.json'), 'utf-8'));

    ok(claudeConfig.mcpServers['shared-server']);
    ok(cursorConfig.mcpServers['shared-server']);
    // Args correctly differ by client_id, proving per-client wiring, not a blind copy
    deepStrictEqual(claudeConfig.mcpServers['shared-server'].args, ['shared-server', 'claude-code']);
    deepStrictEqual(cursorConfig.mcpServers['shared-server'].args, ['shared-server', 'cursor']);
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('activateForClient: never touches a pre-existing human-authored entry in the same file', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const configPath = join(projectRoot, '.mcp.json');

  try {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { 'my-own-tool': { command: 'python', args: ['my_tool.py'] } } })
    );

    activateForClient(db, 'scopewatch-managed-server', CLAUDE_CODE_CLIENT_ID, projectRoot);

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    deepStrictEqual(config.mcpServers['my-own-tool'], { command: 'python', args: ['my_tool.py'] });
    ok(config.mcpServers['scopewatch-managed-server']);
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('deactivateForClient: removes only the Scopewatch-owned entry, preserving everything else', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'scopewatch-activate-'));
  const dbPath = join(projectRoot, 'state.db');
  const db = openDatabase(dbPath);
  const configPath = join(projectRoot, '.mcp.json');

  try {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { 'my-own-tool': { command: 'python', args: ['my_tool.py'] } } })
    );

    activateForClient(db, 'temp-server', CLAUDE_CODE_CLIENT_ID, projectRoot);
    let config = JSON.parse(readFileSync(configPath, 'utf-8'));
    ok(config.mcpServers['temp-server']);

    deactivateForClient(db, 'temp-server', CLAUDE_CODE_CLIENT_ID, projectRoot);
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
    strictEqual(config.mcpServers['temp-server'], undefined);
    ok(config.mcpServers['my-own-tool'], 'unrelated human entry must survive deactivation');
  } finally {
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
