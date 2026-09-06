# Scopewatch — Build Log & Locked Decisions

## Product Promise
Scopewatch is a local-first, CLI-only trust layer for MCP servers and AI agent tools. Core thesis: on every install and update, produce a correct, plain-language **capability diff** showing exactly what a server can read, write, send, delete, or execute—compared to the last time. Everything else exists to support that one moment.

## Locked Technical Stack (non-negotiable)
| Area | Choice |
|---|---|
| Language/runtime | TypeScript on Node.js |
| Diff engine | Custom, tool-scope-aware structured diff (resource-level capability tracking) |
| Local API | Typed service layer behind the CLI |
| State | SQLite with migrations |
| Secrets | OS keychain via native credential APIs only |
| Validation | Zod for manifest validation |
| Packaging | npm package + signed installer script |
| Observability | Structured local logs with automatic secret redaction |
| Testing | Unit + contract + integration + realistic fixture matrix |

## Hard Non-Goals for v1
- No server catalog or curation (point at official MCP registry)
- No dashboard or any GUI (CLI only)
- No profiles, team sharing, or multi-user workflows
- No crowdsourced compatibility matrix, no runtime policy guard
- No Docker or container-based install path
- Only one install adapter: npm/npx
- Only two agent-client adapters in v1 (e.g., Claude Code + Cursor)

## Non-Negotiable UX Rules
1. Never hide whether a tool can read, write, send, delete, or execute.
2. Every diff, every time, is shown **before** the new version is activated—never after.
3. Never silently overwrite user-authored client config.
4. Every error shows a safe default and a clear recovery path.

## Monorepo Structure
```
scopewatch/
  apps/
    cli/                    # command parsing and terminal UX
  packages/
    core/                   # lifecycle domain and orchestration
    diff-engine/            # capability diff computation and rendering
    drift-reconciler/       # client-config comparison and merge logic
    local-api/              # service contract used by the CLI
    manifest/               # schema, parsing, validation, migrations
    state/                  # SQLite repositories and lockfile handling
    secrets/                # keychain abstraction and redaction
    client-adapters/        # one package per agent client
    install-adapters/       # npm/npx only for v1
  fixtures/                 # versioned test servers and client-config fixtures
  docs/                     # quickstart, security model, supported matrix
  e2e/                      # real workflow smoke tests
  .github/                  # CI, release, security automation
```

## Manifest Schema Design (Phase A Locked)

### Core Data Model
Every capability is tracked at the capability level with resource identity:

```typescript
type Verb = 'read' | 'fetch' | 'send' | 'write' | 'delete' | 'execute';
type Provenance = 'declared' | 'inferred';

type CapabilityEntry = {
  tool_id: string;
  verb: Verb;
  resource?: string; // e.g., "repo:owner/name", "filesystem:/*", "http:*"
  provenance: Provenance;
  description?: string; // for inferred entries, explain the inference
};

type SecretDeclaration = {
  id: string; // e.g., "GITHUB_TOKEN"
  description: string;
  required: boolean;
  used_by: string[]; // tool_ids that reference this secret
};

type ServerManifest = {
  schemaVersion: 1;
  version: string; // semver
  source: { type: 'npm' | 'git' | 'local'; location: string };
  checksum: string; // sha256
  tools: Array<{ id: string; name: string; description: string }>;
  capabilities: CapabilityEntry[];
  secrets: SecretDeclaration[];
  metadata?: { author: string; license: string; homepage?: string };
};
```

### Verb Vocabulary Rationale
- **read**: read access to data
- **fetch**: reach out and pull something back (SSRF/prompt-injection risk)
- **send**: push data externally (exfiltration risk)
- **write**: write access to data
- **delete**: delete data
- **execute**: execute commands/code

Fetch and send are deliberately separate; collapsing them discards the threat-model distinction.

### Provenance Tracking
Every verb assignment is tagged `declared` (explicit in manifest) or `inferred` (computed from tool description/parameters). An inferred "execute" renders with lower confidence language than a declared one. This avoids silent false positives.

## Diff Algorithm Design (Phase B Locked)

### Four-Tier Destructiveness Model
1. **Categorical acquisition**: tool goes from read-only to having any of {write, delete, execute}. Loudest language.
2. **Scope expansion**: tool already had destructive verb; scope widens (repo A → repo A+B).
3. **Scope narrowing**: scope reduction (safe).
4. **Cosmetic**: description-only change.

Top-level binary: `newly_destructive: boolean` = true iff any Tier 1 change exists.

### Two-Dimensional Risk Tracking
Diff output simultaneously tracks:
1. **Capability delta** (the four-tier severity model)
2. **Credential delta**: new secrets vs reused secrets. A new tool reusing an existing secret is materially lower risk than a new tool requiring a new secret.

## Phase A Completion ✅ (2026-09-06)

### Delivered
- ✅ Zod schema implementation for ServerManifest with all constraint validation
- ✅ Validation error messages: context-aware, actionable, no raw Zod dumps
- ✅ Test fixtures: 1 valid manifest, 2 malformed manifests covering distinct error types
- ✅ Round-trip test: parse → JSON.stringify → parse with `deepStrictEqual` verification
- ✅ Type guards (`isServerManifest`) and validation result handling

### Phase A Exit Checks (all passing)
```
TAP version 13
1..9
# tests 9, pass 9, fail 0
```

All checks confirmed:
- Hand-written malformed fixtures produce clear, specific errors with recovery suggestions
- Valid manifest round-trips with zero data loss
- All six verbs accepted correctly
- Provenance tracking (declared/inferred) validated
- Secret id format enforcement (uppercase with underscores)

---

## Phase B: Capability Diff Engine ✅ (2026-09-06)

Status: Complete. All 24 test cases passing (15 fixtures + 9 Phase A validation tests).

Commits: 4 (Phase B scaffolding → core algorithm → initial fixes → final items 2/4/5)

### Phase B Scope (P0: correctness of diff is higher than all other P0s)
The diff engine is the product. It must:
1. **Compute capability delta**: added/removed/modified capabilities at resource level
2. **Categorize destructiveness** using the four-tier model:
   - Tier 1: Categorical acquisition (tool goes from no {write|delete|execute} → has any)
   - Tier 2: Scope expansion (same verb, resource scope widens)
   - Tier 3: Scope narrowing (resource scope reduction — safe, but surfaced)
   - Tier 4: Cosmetic (description-only changes — not a capability change)
3. **Track credential delta** (FOUR states, not two):
   - `new`: new secret introduced
   - `reused`: existing secret now used by additional tools
   - `removed`: secret no longer required
   - `required_changed`: secret's `required` field changed from false→true (graceful degradation disappears)
4. **Render plain-language diff** that humans can summarize unaided
5. **Ordering rule**: render by severity descending (Tier 1 first) and group by tool; never by manifest array order

### Diff Gate Policy (locked)
`newly_destructive: boolean = true iff any Tier 1 change exists`

This is the only binary gate for v1. Tier 2 never flips it, even for large scope expansions. If Tier 2 should block in future, that's a Phase 2 runtime-guard decision, not a reason to blur the boundary now.

### Phase B Fixture Matrix (12 cases, locked)

Capability changes (6):
1. Pure addition: new capability on tool already in manifest
2. Pure removal: existing capability removed
3. Scope widening: same tool, same verb, resource constraint widens (e.g., repo:owner/name → repo:*)
4. Scope narrowing: same tool, same verb, resource constraint narrows
5. Description-only: manifest differs only in description text → cosmetic, zero alert
6. Newly destructive verb on existing tool: tool had [read], now [read, write] → Tier 1

Tool-level changes (2):
7. Brand-new tool_id with destructive verb: no prior tool_id in v1.0.0, v1.1.0 introduces it with [write] → Tier 1 (different code path, same tier)
8. Tool removed entirely: tool_id drops from capabilities entirely (not just capabilities trimmed)

Credential changes (3):
9. New required secret, no reuse: new secret_id in v1.1.0, used only by new tools → riskLevel: high
10. New tool reusing existing secret: tool added, references secret already in v1.0.0.used_by → riskLevel: medium
11. Secret flipping required: false → true: same secret_id, required changed [false→true] → required_changed, riskLevel: medium

No-op (1):
12. No-op version bump: checksum/version change, zero capability/secret delta → must render "no capability changes" not silence

### Phase B Acceptance Test Method (locked)
For each of the 12 fixtures, write down the one-sentence summary a correct reading should produce. That sentence is the test assertion. Example:
- Fixture 5 (description-only): Expected summary: "Description updated, no capability changes."
- Fixture 6 (newly destructive): Expected summary: "File reader now has write access to repository (previously read-only)."
- Fixture 12 (no-op): Expected summary: "No capability changes detected."

Test asserts: `rendered_diff.includes(expected_summary)` — the human-readable diff must contain the exact claim.

### Phase B Checklist
- [x] Implement diff computation algorithm
- [x] Build all 12 fixture pairs (JSON files)
- [x] Write expected_summary for each fixture
- [x] Implement diff rendering (severity-ordered, tool-grouped)
- [x] Write tests: each fixture produces diff containing its expected_summary
- [x] Debug and fix all test failures (21/21 tests passing)
  - [x] Tool removal detection (fixtures 02, 08) — special-cased complete tool removals
  - [x] Scope comparison for widening/narrowing (fixtures 03, 04) — refactored indexing to verb-level
  - [x] Categorical acquisition for existing tools (fixture 06) — using `isNewTool` flag
  - [x] Risk level calculation (fixtures 01, 09) — correct mapping of new tools + new secrets to medium

### Phase B Exit Check ✅
All 24 tests passing (15 Phase B fixtures + 9 Phase A validation tests). Diff output includes human-readable summaries without exposing underlying manifests.

**Delivered:**
- **Correct severity classification** at four tiers (Tier 1: categorical_acquisition, Tier 2: scope_expansion, Tier 3: scope_narrowing, Tier 4: cosmetic)
- **Scope change detection** using resource grammar containment check for (tool_id, verb) pairs (e.g., repo:owner/name → repo:owner/* properly detected as widening)
- **Multi-resource handling** with proper scope subsumption (tool with access to discrete repos gains wildcard scope)
- **Complete tool removal detection** with special-case summarization ("tool removed" vs individual capability removals)
- **New tool identification** with `isNewTool` flag distinguishing brand-new tools from existing tools gaining new verbs
- **Provenance-based confidence language**: declared capabilities render as "adds/has" vs inferred as "appears to add/have"
- **Risk level mapping** (high/medium/low/none) per locked rule: new required secret = high (independent of capability tier)
- **Credential change tracking** (new/reused/removed/required_changed) with threat-model-aligned risk assessment
- **Multi-tier ordering** with Tier 1 rendered first, then 2/3/4 by severity, grouped by tool (proven by Fixture 15)
- **Test assertion method** validates rendered plain-language output, not just structural fields (catches unreadable diffs)

## Deviations from Brief (none yet)

## Build Infrastructure Fix (2026-09-06)

**Root cause found and fixed:** the root `package.json`'s `prepare` script ran
`tsc --build` against the root `tsconfig.json`, which had no `outDir`, no
`include`/`exclude`, and no project `references`. This caused it to silently
pick up every `.ts` file across all packages and compile each one **in place**
inside `src/`, ignoring each package's own `outDir: "./dist"`. This ran on
every `npm install` (via the `prepare` lifecycle hook), which is why compiled
`.js`/`.d.ts` files kept reappearing next to source and drifting out of sync
with the real `dist/` output whenever source changed without a manual rebuild.

**Fix:** converted the workspace to a proper TypeScript composite project:
- Every package `tsconfig.json` now sets `"composite": true`
- `diff-engine` declares `"references": [{ "path": "../manifest" }]` (its real
  dependency); `state` currently has no cross-package imports, so no
  references were added there — do not add them speculatively
- Root `tsconfig.json` is now a pure solution file: `"files": []` plus
  `"references"` to all three packages, so `tsc --build` at the root
  topologically builds each package into its own `dist/` and does nothing else
- Removed all git-tracked compiled `.js`/`.d.ts`/`.map` files from `src/` and
  `test/` directories across all three packages - `dist/` (already gitignored)
  is now the only place compiled output exists

**Verified:** `find packages -name "*.tsbuildinfo" -delete && rm -rf packages/*/dist && npm install`
rebuilds cleanly with zero files landing outside `dist/`. Full test suite
(37/37) still passes - tests run against `.ts` source directly via `tsx`, so
they were never affected by this drift, but the committed artifacts a
consumer of these packages would actually import (`main`/`types` in each
`package.json` point at `./dist/...`) were silently stale until now.

**Outstanding requirement (no CI exists yet, so not built now):** once CI is
set up, add a step that does a clean build and diffs the result against
whatever is committed (if anything ever needs to be committed again - under
the current setup nothing in `dist/` is committed, so this reduces to "clean
build succeeds with no tsc errors," but the check should still exist
explicitly rather than being assumed).

---

## Phase D: Install Adapter (npm/npx) ✅ (2026-09-06)

**Node minimum: 22.0.0** (corrected from an initially-proposed 18.0.0, which was
already two EOL cycles out of date the day this was written - Node 18 EOL'd
2025-04-30, Node 20 EOL'd 2026-04-30. Node 22 is Maintenance LTS through
2027-04; Node 24 is current Active LTS and is recommended, though not
required, in doctor-style messaging).

### Failure categorization (locked)
Matches on npm's own stable error codes, not free-text pattern matching:

| Category | npm signal | 
|---|---|
| `node_not_installed` | `node --version` throws ENOENT |
| `node_version_too_old` | parsed version `< 22.0.0` |
| `npm_not_installed` | `npm --version` throws ENOENT |
| `package_not_found` | `E404`, `ETARGET` |
| `network_unreachable` | `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `ETIMEDOUT` |
| `permission_denied` | `EACCES`, `EPERM` |
| `entry_point_broken` | see scope note below |
| `unrecognized` | fallback - still structured, never a raw crash |

### `entry_point_broken` scope (deliberately minimal)
Confirms the package's declared entry file exists on disk and, for a plain
Node script, that importing it doesn't throw synchronously. This is a load
smoke-check, NOT a protocol handshake. MCP servers speak JSON-RPC over stdio
and don't have a `--version`-and-exit surface - actually starting one and
checking for a working handshake is real estate owned by `scopewatch test
<server>` and the diagnostics module (Phase I), not Phase D. Documented
directly in the code (`errors.ts`) so this boundary isn't accidentally
"improved" into protocol testing later.

### Prerequisite detection is separate from install, not discovered mid-install
`checkPrerequisites()` is standalone and independently testable. `scopewatch
doctor` calls it directly; `installPackage()` calls it FIRST, before any npm
invocation - a bad environment is reported immediately, never discovered
after a partial install. Verified by a test asserting npm is never invoked
when the prerequisite check fails.

### Testing split: offline unit tests vs. network-dependent e2e
- `packages/install-adapters/test/`: fully offline, fixture-based (captured
  real npm stderr per failure category, injected command runners for
  Node/npm detection). Verified offline by running with a broken proxy
  configured (`HTTP_PROXY=http://127.0.0.1:1`) - all 22 tests still pass,
  confirming zero real network or subprocess calls happen in this suite.
- `e2e/install-adapter-real-npm.test.ts`: real npm install against the real
  registry (using `ms`, a small stable zero-dep package, purely as an install
  target). Deliberately excluded from `npm test`'s glob
  (`packages/**/test/**`); runs via `npm run test:e2e` on a separate,
  less-frequent cadence (pre-release / scheduled CI), not on every push.
  Found and correctly handled a real environmental fact during
  implementation: this dev machine runs Node 21.7.1, below the 22.0.0
  floor - the e2e prerequisite test asserts this honestly rather than masking
  it, and the install/categorization tests call npm directly (bypassing the
  prerequisite gate) since they exist to test real registry behavior, not
  re-litigate this machine's Node version.

Full suite: 59/59 passing (37 Phase A/B/C + 22 Phase D offline). e2e: 4/4
passing against the real npm registry.

---

**Last updated:** 2026-09-06 (Phase A ✅, Phase B ✅, Phase C ✅, Phase D ✅ complete)  
**Commits:** 7 (Phase A + Phase B implementation/fixes + Phase C lifecycle engine/fixes + build infra fix + Phase D install adapter)
