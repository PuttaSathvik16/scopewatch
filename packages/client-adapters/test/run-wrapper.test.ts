import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, insertManifest, LifecycleEngine } from '@scopewatch/state';
import { storeSecret, deleteSecret, secretRef } from '@scopewatch/secrets';
import { runWrapper } from '../src/run-wrapper.js';
import type { SpawnFn } from '../src/run-wrapper.js';

function fakeChild() {
  const emitter = new EventEmitter() as EventEmitter & { pid: number; kill: (sig: string) => void };
  emitter.pid = 12345;
  emitter.kill = () => {};
  return emitter;
}

function fakeProcess() {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  return {
    on: (event: string, handler: (...a: any[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event]!.push(handler);
    },
    kill: () => {},
    exit: () => {},
    pid: 999,
    removeAllListeners: () => {},
    _handlers: handlers,
  };
}

test('runWrapper: STATE GATE - refuses to launch when the pair is not active (e.g. update pending review)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-wrapper-test-'));
  const dbPath = join(dir, 'state.db');
  const db = openDatabase(dbPath);

  try {
    const manifestId = insertManifest(
      db,
      'test-server',
      '1.0.0',
      'npm',
      'test-server',
      'sha256:test',
      JSON.stringify({ source: { type: 'npm', location: 'test-server' }, secrets: [] })
    );

    const engine = new LifecycleEngine(db);
    // Walk to 'active', then begin an update (leaves state at 'updated', not 'active')
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('test-server', 'claude-code', from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }

    const manifestId2 = insertManifest(
      db,
      'test-server',
      '1.1.0',
      'npm',
      'test-server',
      'sha256:test2',
      JSON.stringify({ source: { type: 'npm', location: 'test-server' }, secrets: [] })
    );
    const updateIntent = engine.startTransition('test-server', 'claude-code', 'active', 'updated', null);
    engine.confirmTransition(updateIntent, manifestId2);
    strictEqual(engine.getState('test-server', 'claude-code'), 'updated', 'setup: pair should be in updated state, not active');

    let spawnWasCalled = false;
    const spawnFn: SpawnFn = () => {
      spawnWasCalled = true;
      return fakeChild() as any;
    };

    const stderrLines: string[] = [];
    const exitCode = await runWrapper('test-server', 'claude-code', {
      db,
      spawn: spawnFn,
      stderr: (line) => stderrLines.push(line),
    });

    strictEqual(exitCode, 1, 'wrapper must exit non-zero when refusing to launch');
    strictEqual(spawnWasCalled, false, 'the real server must NEVER be spawned when the pair is not active');
    ok(
      stderrLines.some((l) => l.includes('refusing to launch') && l.includes('updated')),
      `Expected an actionable refusal message naming the actual state. Got: ${JSON.stringify(stderrLines)}`
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runWrapper: when active, launches the real server successfully', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-wrapper-test-'));
  const dbPath = join(dir, 'state.db');
  const db = openDatabase(dbPath);

  try {
    const manifestId = insertManifest(
      db,
      'test-server',
      '1.0.0',
      'npm',
      'test-server',
      'sha256:test',
      JSON.stringify({ source: { type: 'npm', location: 'test-server' }, secrets: [] })
    );

    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('test-server', 'claude-code', from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }
    strictEqual(engine.getState('test-server', 'claude-code'), 'active');

    let spawnedCommand: string | undefined;
    let spawnedArgs: string[] | undefined;
    const child = fakeChild();
    const spawnFn: SpawnFn = (command, args) => {
      spawnedCommand = command;
      spawnedArgs = args;
      process.nextTick(() => child.emit('exit', 0, null));
      return child as any;
    };

    const exitCode = await runWrapper('test-server', 'claude-code', { db, spawn: spawnFn });

    strictEqual(exitCode, 0, 'should propagate the real server\'s exit code');
    strictEqual(spawnedCommand, 'npx');
    ok(spawnedArgs?.includes('test-server'), 'should spawn using the manifest\'s source location');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runWrapper: FAIL LOUD - refuses to launch if a required secret cannot be retrieved', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-wrapper-test-'));
  const dbPath = join(dir, 'state.db');
  const db = openDatabase(dbPath);

  try {
    // Manifest declares a required secret that is deliberately never stored
    const manifestId = insertManifest(
      db,
      'secret-needing-server',
      '1.0.0',
      'npm',
      'secret-needing-server',
      'sha256:test',
      JSON.stringify({
        source: { type: 'npm', location: 'secret-needing-server' },
        secrets: [{ id: 'MISSING_TOKEN' }],
      })
    );

    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('secret-needing-server', 'claude-code', from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }

    let spawnWasCalled = false;
    const spawnFn: SpawnFn = () => {
      spawnWasCalled = true;
      return fakeChild() as any;
    };

    const stderrLines: string[] = [];
    const exitCode = await runWrapper('secret-needing-server', 'claude-code', {
      db,
      spawn: spawnFn,
      stderr: (line) => stderrLines.push(line),
    });

    strictEqual(exitCode, 1);
    strictEqual(spawnWasCalled, false, 'the real server must NEVER be spawned without its required secrets');
    ok(
      stderrLines.some((l) => l.includes('failed to retrieve required secrets')),
      `Expected a fail-loud secret error. Got: ${JSON.stringify(stderrLines)}`
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runWrapper: when the required secret IS available, it is injected into the spawned process env', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-wrapper-test-'));
  const dbPath = join(dir, 'state.db');
  const db = openDatabase(dbPath);
  const ref = secretRef('secret-server-2', 'MY_TOKEN');

  try {
    storeSecret(ref, 'the-real-secret-value');

    const manifestId = insertManifest(
      db,
      'secret-server-2',
      '1.0.0',
      'npm',
      'secret-server-2',
      'sha256:test',
      JSON.stringify({
        source: { type: 'npm', location: 'secret-server-2' },
        secrets: [{ id: 'MY_TOKEN' }],
      })
    );

    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('secret-server-2', 'claude-code', from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }

    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const child = fakeChild();
    const spawnFn: SpawnFn = (_cmd, _args, options) => {
      capturedEnv = options.env;
      process.nextTick(() => child.emit('exit', 0, null));
      return child as any;
    };

    const exitCode = await runWrapper('secret-server-2', 'claude-code', { db, spawn: spawnFn });

    strictEqual(exitCode, 0);
    strictEqual(capturedEnv?.['MY_TOKEN'], 'the-real-secret-value');
  } finally {
    deleteSecret(ref);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runWrapper: signal sent to wrapper is forwarded to the child process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scopewatch-wrapper-test-'));
  const dbPath = join(dir, 'state.db');
  const db = openDatabase(dbPath);

  try {
    const manifestId = insertManifest(
      db,
      'signal-test-server',
      '1.0.0',
      'npm',
      'signal-test-server',
      'sha256:test',
      JSON.stringify({ source: { type: 'npm', location: 'signal-test-server' }, secrets: [] })
    );
    const engine = new LifecycleEngine(db);
    for (const [from, to] of [
      ['discovered', 'reviewed'],
      ['reviewed', 'installed'],
      ['installed', 'configured'],
      ['configured', 'validated'],
      ['validated', 'active'],
    ] as [string, string][]) {
      const id = engine.startTransition('signal-test-server', 'claude-code', from as any, to as any, null);
      engine.confirmTransition(id, manifestId);
    }

    const child = fakeChild();
    let killedWithSignal: string | undefined;
    child.kill = (sig: string) => {
      killedWithSignal = sig;
      process.nextTick(() => child.emit('exit', null, sig));
    };

    const spawnFn: SpawnFn = () => child as any;
    const fp = fakeProcess();

    const resultPromise = runWrapper('signal-test-server', 'claude-code', { db, spawn: spawnFn, process: fp as any });

    // Simulate the client sending SIGTERM to the wrapper
    await new Promise((r) => setTimeout(r, 10));
    for (const handler of fp._handlers['SIGTERM'] ?? []) handler();

    await resultPromise;
    strictEqual(killedWithSignal, 'SIGTERM', 'the wrapper must forward the signal to the real child process');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
