import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import {
  parseManifest,
  validateManifest,
  isServerManifest,
  type ServerManifest,
} from '../src/schema.js';
import { formatValidationErrors } from '../src/errors.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, '../fixtures');

function loadFixture(name: string): unknown {
  const path = join(fixturesDir, name);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

test('Phase A Exit Check: Valid Manifest Round-Trip', () => {
  const validManifest = loadFixture('valid-manifest.json');

  // Parse should succeed
  const result = parseManifest(validManifest);
  strictEqual(result.ok, true, 'valid manifest should parse successfully');

  if (!result.ok) return; // TypeScript guard

  const parsed = result.value;

  // Round-trip: serialize and parse again
  const serialized = JSON.stringify(parsed);
  const reparsed = JSON.parse(serialized);
  const result2 = validateManifest(reparsed);

  strictEqual(result2.ok, true, 'round-trip parse should succeed');
  deepStrictEqual(parsed, reparsed, 'round-trip should have no data loss');
});

test('Validation: Missing tool_id in capability', () => {
  const malformed = loadFixture('malformed-missing-tool-id.json');
  const result = parseManifest(malformed);

  strictEqual(result.ok, false, 'malformed manifest should fail');
  if (result.ok) return;

  const errors = result.errors;
  ok(errors.length > 0, 'should produce at least one error');

  // Find the error related to tool_id
  const toolIdError = errors.find(e => e.path.includes('tool_id'));
  ok(toolIdError, 'should have an error about missing tool_id');

  // Format the error and check it's readable
  const formatted = formatValidationErrors([toolIdError!]);
  ok(formatted.includes('tool_id'), 'error message should mention tool_id');
  ok(formatted.includes('❌'), 'error should have visual indicator');
  console.log('Error message for missing tool_id:\n', formatted);
});

test('Validation: Invalid semver version', () => {
  const malformed = loadFixture('malformed-invalid-version.json');
  const result = parseManifest(malformed);

  strictEqual(result.ok, false, 'manifest with invalid version should fail');
  if (result.ok) return;

  const errors = result.errors;
  const versionError = errors.find(e => e.path.includes('version'));
  ok(versionError, 'should have an error about version');

  const formatted = formatValidationErrors([versionError!]);
  ok(formatted.includes('semver'), 'error should mention semver requirement');
  console.log('Error message for invalid version:\n', formatted);
});

test('Type Guard: isServerManifest', () => {
  const validManifest = loadFixture('valid-manifest.json');
  strictEqual(isServerManifest(validManifest), true, 'valid manifest should pass type guard');

  const malformed = loadFixture('malformed-missing-tool-id.json');
  strictEqual(isServerManifest(malformed), false, 'malformed manifest should fail type guard');

  strictEqual(isServerManifest(null), false, 'null should fail type guard');
  strictEqual(isServerManifest({}), false, 'empty object should fail type guard');
});

test('Validation: Tool must reference valid verb', () => {
  const invalid = {
    schemaVersion: 1,
    version: '1.0.0',
    source: { type: 'npm' as const, location: 'example' },
    checksum: 'abc',
    tools: [{ id: 'tool1', name: 'Tool', description: 'A tool' }],
    capabilities: [
      {
        tool_id: 'tool1',
        verb: 'invalid-verb', // This should fail
        provenance: 'declared' as const,
      },
    ],
    secrets: [],
  };

  const result = parseManifest(invalid);
  strictEqual(result.ok, false, 'invalid verb should fail validation');

  if (!result.ok) {
    const formatted = formatValidationErrors(result.errors);
    console.log('Error message for invalid verb:\n', formatted);
  }
});

test('Validation: All six verbs are accepted', () => {
  const verbs = ['read', 'fetch', 'send', 'write', 'delete', 'execute'] as const;

  for (const verb of verbs) {
    const manifest = {
      schemaVersion: 1,
      version: '1.0.0',
      source: { type: 'npm' as const, location: 'example' },
      checksum: 'abc',
      tools: [{ id: 'tool1', name: 'Tool', description: 'A tool' }],
      capabilities: [
        {
          tool_id: 'tool1',
          verb,
          provenance: 'declared' as const,
        },
      ],
      secrets: [],
    };

    const result = parseManifest(manifest);
    strictEqual(result.ok, true, `verb "${verb}" should be valid`);
  }
});

test('Validation: Provenance must be declared or inferred', () => {
  const invalid = {
    schemaVersion: 1,
    version: '1.0.0',
    source: { type: 'npm' as const, location: 'example' },
    checksum: 'abc',
    tools: [{ id: 'tool1', name: 'Tool', description: 'A tool' }],
    capabilities: [
      {
        tool_id: 'tool1',
        verb: 'read' as const,
        provenance: 'guessed', // Invalid
      },
    ],
    secrets: [],
  };

  const result = parseManifest(invalid);
  strictEqual(result.ok, false, 'invalid provenance should fail');
});

test('Validation: Secret id must be uppercase with underscores', () => {
  const invalid = {
    schemaVersion: 1,
    version: '1.0.0',
    source: { type: 'npm' as const, location: 'example' },
    checksum: 'abc',
    tools: [{ id: 'tool1', name: 'Tool', description: 'A tool' }],
    capabilities: [],
    secrets: [
      {
        id: 'invalid-secret-id', // Should be INVALID_SECRET_ID
        description: 'A secret',
        required: true,
        used_by: [],
      },
    ],
  };

  const result = parseManifest(invalid);
  strictEqual(result.ok, false, 'lowercase secret id should fail');

  if (!result.ok) {
    const formatted = formatValidationErrors(result.errors);
    console.log('Error message for lowercase secret id:\n', formatted);
  }
});

test('Complete Manifest: Realistic Before/After Pair', () => {
  // This will be used for diff engine tests later
  const before: ServerManifest = {
    schemaVersion: 1,
    version: '1.0.0',
    source: { type: 'npm', location: 'example-tools' },
    checksum: 'sha256:before',
    tools: [
      { id: 'reader', name: 'File Reader', description: 'Read files' },
    ],
    capabilities: [
      { tool_id: 'reader', verb: 'read', resource: 'repo:*', provenance: 'declared' },
    ],
    secrets: [
      { id: 'GITHUB_TOKEN', description: 'GitHub token', required: true, used_by: ['reader'] },
    ],
  };

  const after: ServerManifest = {
    schemaVersion: 1,
    version: '1.1.0',
    source: { type: 'npm', location: 'example-tools' },
    checksum: 'sha256:after',
    tools: [
      { id: 'reader', name: 'File Reader', description: 'Read files' },
      { id: 'writer', name: 'File Writer', description: 'Write files' },
    ],
    capabilities: [
      { tool_id: 'reader', verb: 'read', resource: 'repo:*', provenance: 'declared' },
      { tool_id: 'writer', verb: 'read', resource: 'repo:*', provenance: 'declared' },
      { tool_id: 'writer', verb: 'write', resource: 'repo:*', provenance: 'declared' },
    ],
    secrets: [
      { id: 'GITHUB_TOKEN', description: 'GitHub token', required: true, used_by: ['reader', 'writer'] },
    ],
  };

  // Both should validate
  strictEqual(validateManifest(before).ok, true, 'before manifest should validate');
  strictEqual(validateManifest(after).ok, true, 'after manifest should validate');

  // Store for later use in diff engine tests
  console.log('Before/After fixture pair created for Phase B diff engine tests');
});
