import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@scopewatch/state';
import * as cmds from '../src/commands.js';

/**
 * Command-wiring audit found cmdDoctor - the actual function main.ts's
 * 'doctor' command calls - had zero direct test coverage anywhere, despite
 * the underlying checkPrerequisites() being well-tested at the
 * install-adapters level. Closing the gap for the same reason cmdRollback
 * and cmdDeactivate needed it: a correct underlying module behind an
 * untested command wrapper is still an untested command.
 */
test('cmdDoctor: reports ok with real version strings when prerequisites are met (injected runner)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-cmddoctor-'));
  const db = openDatabase(join(dir, 'state.db'));

  try {
    const result = cmds.cmdDoctor({
      db,
      prereqRunner: (command: string) => (command === 'node' ? 'v22.5.0\n' : '10.8.2\n'),
    });
    strictEqual(result.ok, true);
    if (result.ok) {
      strictEqual(result.nodeVersion, '22.5.0');
      strictEqual(result.npmVersion, '10.8.2');
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cmdDoctor: reports the categorized, actionable error when Node is below the floor (injected runner)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-cmddoctor-'));
  const db = openDatabase(join(dir, 'state.db'));

  try {
    const result = cmds.cmdDoctor({
      db,
      prereqRunner: () => 'v18.19.0\n',
    });
    strictEqual(result.ok, false);
    if (!result.ok) {
      strictEqual(result.error.category, 'node_version_too_old');
      ok(result.error.message.includes('18.19.0') && result.error.message.includes('22.0.0'));
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
