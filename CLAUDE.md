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

## Current Phase: B — Capability Diff Engine (design locked, implementation pending)

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
- [ ] Implement diff computation algorithm
- [ ] Build all 12 fixture pairs (JSON files)
- [ ] Write expected_summary for each fixture
- [ ] Implement diff rendering (severity-ordered, tool-grouped)
- [ ] Write tests: each fixture produces diff containing its expected_summary
- [ ] Verify all tests pass

### Phase B Exit Check
All 12 fixtures pass: diff output includes the human-readable summary without the underlying manifests visible.

## Deviations from Brief (none yet)

---

**Last updated:** 2026-09-06 (Phase A complete, Phase B ready)  
**Commits:** 1 (Phase A foundation)
