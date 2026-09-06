import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferCapabilities } from '../src/infer.js';
import type { McpTool } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadRealTools(): McpTool[] {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', 'real-filesystem-server-tools.json'), 'utf-8'));
}

function findCap(result: ReturnType<typeof inferCapabilities>, toolId: string) {
  return result.capabilities.find((c) => c.tool_id === toolId);
}

// --- Validated against 14 REAL tools captured from a live run of the actual
// @modelcontextprotocol/server-filesystem (test/fixtures/real-filesystem-server-tools.json) ---

test('real data: all 9 read-only-annotated tools infer to read', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  const readOnlyToolIds = [
    'read_file',
    'read_text_file',
    'read_media_file',
    'read_multiple_files',
    'list_directory',
    'list_directory_with_sizes',
    'directory_tree',
    'search_files',
    'get_file_info',
  ];

  for (const id of readOnlyToolIds) {
    const cap = findCap(result, id);
    ok(cap, `capability for ${id} should exist`);
    strictEqual(cap!.verb, 'read', `${id} should infer to read`);
    strictEqual(cap!.provenance, 'inferred');
  }
});

test('real data: write_file and edit_file (destructiveHint:true, write-shaped keywords) infer to write', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  strictEqual(findCap(result, 'write_file')!.verb, 'write');
  strictEqual(findCap(result, 'edit_file')!.verb, 'write');
});

test('real data: create_directory (destructiveHint:false, readOnlyHint:false, "create" keyword) infers to write', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  strictEqual(findCap(result, 'create_directory')!.verb, 'write');
});

test('real data: list_allowed_directories has no path-like param and resolves resource to wildcard', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  const cap = findCap(result, 'list_allowed_directories')!;
  strictEqual(cap.verb, 'read');
  strictEqual(cap.resource, '*', 'no path-like parameter exists on this tool, so resource must be the honest wildcard, not a guessed filesystem scope');
});

test('real data: tools with a "path" parameter resolve resource to filesystem:*', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  strictEqual(findCap(result, 'read_file')!.resource, 'filesystem:*');
  strictEqual(findCap(result, 'write_file')!.resource, 'filesystem:*');
});

// --- The genuinely ambiguous real case, as required ---

test('AMBIGUOUS CASE: move_file (destructiveHint:true, "move"/"rename" deliberately not a write signal) infers to delete, not write', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  const cap = findCap(result, 'move_file')!;
  // Real judgment call, documented here and in infer.ts: a relocation both
  // creates at the destination and vacates the source. destructiveHint:true
  // is the server's own admission of real consequence; with no keyword
  // specific enough to positively identify write/execute, the destructive-
  // pool DEFAULT (delete) applies rather than downgrading to the mildest
  // destructive option. This treats "we don't know exactly which destructive
  // effect" as license to show MORE caution, not less, per the project's
  // standing posture since Phase B.
  strictEqual(cap.verb, 'delete', 'move_file should resolve to the destructive-pool default (delete), not write');
});

// --- The two new conflict-handling rules, each with a dedicated synthetic fixture ---

test('CONTRADICTION: a tool declaring both readOnlyHint and destructiveHint true resolves to the destructive pool AND is flagged', () => {
  const tool: McpTool = {
    name: 'weird_tool',
    description: 'Does something with data.',
    annotations: { readOnlyHint: true, destructiveHint: true },
  };

  const result = inferCapabilities('test-server', [tool]);
  const cap = findCap(result, 'weird_tool')!;

  strictEqual(cap.verb, 'delete', 'contradictory annotations must resolve to the more cautious (destructive) classification');
  ok(
    result.warnings.some((w) => w.includes('weird_tool') && w.includes('contradictory')),
    `Expected a contradiction warning naming the tool. Got: ${JSON.stringify(result.warnings)}`
  );
});

test('OVERRIDE: keyword evidence more severe than a declared safe hint wins, and is flagged', () => {
  const tool: McpTool = {
    name: 'benign_reader',
    description: 'Reads a value then permanently deletes the old cache file.',
    annotations: { readOnlyHint: true },
  };

  const result = inferCapabilities('test-server', [tool]);
  const cap = findCap(result, 'benign_reader')!;

  strictEqual(
    cap.verb,
    'delete',
    'a tool declared readOnlyHint:true but whose description mentions deletion must resolve to delete, not read - ' +
      'a server should not be able to silently suppress an alarming signal in its own tool description via a mild self-reported hint'
  );
  ok(
    result.warnings.some((w) => w.includes('benign_reader') && w.includes('more severe')),
    `Expected an override warning naming the tool. Got: ${JSON.stringify(result.warnings)}`
  );
});

// --- No-annotations-at-all fallback (branch 4), exercised with a synthetic tool ---

test('no annotations at all: pure keyword fallback still classifies correctly', () => {
  const tool: McpTool = {
    name: 'delete_record',
    description: 'Deletes a record from the database permanently.',
  };

  const result = inferCapabilities('test-server', [tool]);
  strictEqual(findCap(result, 'delete_record')!.verb, 'delete');
});

test('no annotations at all: genuinely no keyword signal falls back to the conservative execute default', () => {
  const tool: McpTool = {
    name: 'do_thing',
    description: 'Performs an unspecified operation.',
  };

  const result = inferCapabilities('test-server', [tool]);
  strictEqual(findCap(result, 'do_thing')!.verb, 'execute');
});

test('every inferred capability is tagged provenance: inferred, never declared', () => {
  const tools = loadRealTools();
  const result = inferCapabilities('server-filesystem', tools);

  for (const cap of result.capabilities) {
    strictEqual(cap.provenance, 'inferred');
  }
});

test('snake_case tool names are correctly tokenized (word-boundary normalization)', () => {
  // Guards against the real bug this design had to work around: \bwrite\b
  // does NOT match inside "write_file" without normalizing underscores to
  // spaces first, since _ is a \w character in JS regex.
  const tool: McpTool = { name: 'write_file', description: 'x' };
  const result = inferCapabilities('test-server', [tool]);
  strictEqual(findCap(result, 'write_file')!.verb, 'write');
});
