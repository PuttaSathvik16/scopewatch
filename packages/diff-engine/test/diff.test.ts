import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDiff, renderDiff, extractSummary } from '../src/index.js';
import type { ServerManifest } from '@scopewatch/manifest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = join(__dirname, '../fixtures');

function loadFixture(name: string): ServerManifest {
  const path = join(fixturesDir, name);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

interface FixtureTest {
  name: string;
  fromFile: string;
  toFile: string;
  expectedSummary: string;
  expectedNewlyDestructive: boolean;
  expectedRiskLevel: 'none' | 'low' | 'medium' | 'high';
}

const fixtures: FixtureTest[] = [
  {
    name: 'Fixture 01: Pure Addition',
    fromFile: 'fixture-01-pure-addition-from.json',
    toFile: 'fixture-01-pure-addition-to.json',
    expectedSummary: 'New tool added: writer with write access',
    expectedNewlyDestructive: true,
    expectedRiskLevel: 'high',
  },
  {
    name: 'Fixture 02: Pure Removal',
    fromFile: 'fixture-02-pure-removal-from.json',
    toFile: 'fixture-02-pure-removal-to.json',
    expectedSummary: 'writer tool removed',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'low',
  },
  {
    name: 'Fixture 03: Scope Widening',
    fromFile: 'fixture-03-scope-widening-from.json',
    toFile: 'fixture-03-scope-widening-to.json',
    expectedSummary: 'now has read access to repo:*',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'medium',
  },
  {
    name: 'Fixture 04: Scope Narrowing',
    fromFile: 'fixture-04-scope-narrowing-from.json',
    toFile: 'fixture-04-scope-narrowing-to.json',
    expectedSummary: 'scope narrowed',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'low',
  },
  {
    name: 'Fixture 05: Description-Only Change',
    fromFile: 'fixture-05-description-only-from.json',
    toFile: 'fixture-05-description-only-to.json',
    expectedSummary: 'No capability changes detected',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'none',
  },
  {
    name: 'Fixture 06: Newly Destructive Verb on Existing Tool',
    fromFile: 'fixture-06-newly-destructive-on-existing-from.json',
    toFile: 'fixture-06-newly-destructive-on-existing-to.json',
    expectedSummary: 'now has write access',
    expectedNewlyDestructive: true,
    expectedRiskLevel: 'high',
  },
  {
    name: 'Fixture 07: Brand-New Tool with Destructive Verb',
    fromFile: 'fixture-07-new-tool-destructive-from.json',
    toFile: 'fixture-07-new-tool-destructive-to.json',
    expectedSummary: 'New tool added: deleter with delete access',
    expectedNewlyDestructive: true,
    expectedRiskLevel: 'high',
  },
  {
    name: 'Fixture 08: Tool Removed Entirely',
    fromFile: 'fixture-08-tool-removed-from.json',
    toFile: 'fixture-08-tool-removed-to.json',
    expectedSummary: 'deleter tool removed',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'low',
  },
  {
    name: 'Fixture 09: New Required Secret, No Reuse',
    fromFile: 'fixture-09-new-secret-required-from.json',
    toFile: 'fixture-09-new-secret-required-to.json',
    expectedSummary: 'requires new credential: SLACK_BOT_TOKEN',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'medium',
  },
  {
    name: 'Fixture 10: New Tool Reusing Existing Secret',
    fromFile: 'fixture-10-new-tool-reusing-secret-from.json',
    toFile: 'fixture-10-new-tool-reusing-secret-to.json',
    expectedSummary: 'with write access',
    expectedNewlyDestructive: true,
    expectedRiskLevel: 'high',
  },
  {
    name: 'Fixture 11: Secret Flipping Required: false → true',
    fromFile: 'fixture-11-secret-required-changed-from.json',
    toFile: 'fixture-11-secret-required-changed-to.json',
    expectedSummary: 'now required',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'medium',
  },
  {
    name: 'Fixture 12: No-Op Version Bump',
    fromFile: 'fixture-12-noop-version-bump-from.json',
    toFile: 'fixture-12-noop-version-bump-to.json',
    expectedSummary: 'No capability changes detected',
    expectedNewlyDestructive: false,
    expectedRiskLevel: 'none',
  },
];

for (const fixture of fixtures) {
  test(`Phase B: ${fixture.name}`, () => {
    const from = loadFixture(fixture.fromFile);
    const to = loadFixture(fixture.toFile);

    const diff = computeDiff(from, to);

    // Check newly_destructive gate
    strictEqual(
      diff.newly_destructive,
      fixture.expectedNewlyDestructive,
      `newly_destructive should be ${fixture.expectedNewlyDestructive}`
    );

    // Check risk level
    strictEqual(
      diff.riskLevel,
      fixture.expectedRiskLevel,
      `riskLevel should be ${fixture.expectedRiskLevel}`
    );

    // Render the diff
    const rendered = renderDiff(diff);
    ok(rendered, 'renderDiff should produce output');

    // Extract summary for assertion
    const summary = extractSummary(diff);
    ok(
      summary.toLowerCase().includes(fixture.expectedSummary.toLowerCase()),
      `Summary should include "${fixture.expectedSummary}". Got: "${summary}"`
    );

    // Verify rendered output includes the summary
    const renderedLower = rendered.toLowerCase();
    const summaryLower = fixture.expectedSummary.toLowerCase();

    if (!renderedLower.includes(summaryLower)) {
      console.log(`\nFixture: ${fixture.name}`);
      console.log(`Expected summary phrase: "${fixture.expectedSummary}"`);
      console.log(`Actual rendered output:\n${rendered}\n`);
    }

    ok(
      renderedLower.includes(summaryLower),
      `Rendered output should contain summary phrase`
    );
  });
}
