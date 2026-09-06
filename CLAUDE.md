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

## Phase E: Install Adapter (npm/npx) ✅ (2026-09-06)

**Labeling correction:** this was tracked as "Phase D" throughout its own
implementation and review - a mislabeling that carried through several
messages before being caught. Per the original brief's actual phase order,
this is **Phase E** (install adapter). **Phase D (Secrets) has not been built
yet** and is next. No technical harm from the ordering - install-adapters and
secrets are sibling packages with no dependency on each other, and Phase C's
lifecycle engine was deliberately built side-effect-agnostic
(`pending_side_effects` is a plain string array) to accommodate either
arriving first. This section is renamed to the correct phase letter so a
future session doesn't inherit the same confusion.

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
<server>` and the diagnostics module (Phase I), not Phase E. Documented
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

Full suite: 59/59 passing (37 Phase A/B/C + 22 Phase E offline). e2e: 4/4
passing against the real npm registry.

---

## Phase D: Secrets ✅ (2026-09-06)

### Keychain approach: shell out to native OS CLIs, not a native Node addon
Given the `better-sqlite3` ABI pain from Phase C (prebuilt binary required
Node >=22, segfaulted on this machine's Node 21.7.1), native Node addons for
keychain access (`keytar`, `@napi-rs/keyring`) were rejected in favor of
shelling out directly to each OS's own credential tooling. This still
satisfies "native credential APIs only" - it's literally the OS's own
tooling, just invoked as a subprocess instead of linked as a native addon,
with zero prebuilt-binary/ABI risk.

| OS | Mechanism |
|---|---|
| macOS | `/usr/bin/security` (ships with macOS) |
| Linux | `secret-tool` (from `libsecret-tools`, Secret Service API over D-Bus) |
| Windows | `powershell.exe` + inline C# `Add-Type` P/Invoke of `CredWrite`/`CredRead`/`CredDelete` (Advapi32.dll) - **unverified on real Windows**, this dev environment is macOS; implemented strictly per documented Win32 API contracts, must be validated on real Windows before production use |

### Critical fix found by testing, not assumed: `security`'s `-w` flag exposes the value in argv
Initial design assumed `security add-generic-password -w <value>` was
parallel to `secret-tool store`'s stdin-based input. It is not: verified
directly against `security add-generic-password -h` on this dev machine -
`-w <value>` puts the value in the subprocess's command-line arguments,
visible to any process with `ps`/Activity Monitor access for the life of
the subprocess. `-w` with **no value, as the truly-last token** instead
makes `security` read the password from stdin as a confirm+retype pair
(`value\nvalue\n`) - confirmed empirically via a disposable test keychain
and a live login-keychain round-trip (both cleaned up immediately after).
The Windows PowerShell script was designed the same way from the start
(`[Console]::In.ReadToEnd()`, never string-interpolated into `-Command`),
once the macOS finding made clear this class of leak applies wherever a
"pass the secret as a command-line flag" shortcut is tempting.

### No-keychain-backend fallback: fail loudly, no custom crypto
Headless/CI Linux with no D-Bus Secret Service running is a real, common
gap. The locked stack rule ("no custom crypto, no plaintext anywhere") rules
out any encrypted-file fallback - such a fallback needs its own encryption
key stored *somewhere*, recreating the exact problem it claims to solve.
When no backend is detected (`secret-tool` missing, or present but
unable to reach a Secret Service), storage fails with a categorized,
actionable `no_keychain_backend` error. Scopewatch is simply not usable for
secret-requiring servers on such a machine until a keychain is provisioned -
the correct tradeoff, not a limitation to engineer around.

### Opaque references, never values, in state
`secretRef(server_id, secret_id)` (e.g. `"@mcp/server-github:GITHUB_TOKEN"`)
is the single code path allowed to construct a keychain account reference -
store/retrieve/delete all go through it, so store-time and lookup-time keys
can never drift apart. Only the secret's `id` (a label, e.g.
`"GITHUB_TOKEN"`) is ever recorded in a manifest or the SQLite state from
Phase C - never a value. A secret value exists in memory only: briefly after
the terminal prompt reads it, for the duration of the keychain `store()`
subprocess call, and for the duration of `retrieve()` immediately before
being placed into the `env` object passed to `child_process.spawn()` at
activation.

### Redaction-first logging (built fresh, nothing to retrofit)
No logging module existed anywhere before Phase D. Built
`createLogger()`/`redact()` with redaction as a first-class feature:
content-based (any registered live secret VALUE gets replaced wherever it
appears, including embedded in unrelated error text), not key-name-based.
`retrieveSecret()` registers a retrieved value for redaction inside a
`finally` block wrapping the platform-specific read - guaranteed even if
something else throws immediately after a successful retrieval. Verified
with a real test (`keychain-dispatch.test.ts`) that a later secret in a
batch failing does not un-protect an earlier secret that already succeeded.

### Secure prompt
`promptSecret()` uses `readline` with output muted during input (no
terminal echo) and requires a real TTY on stdin by default - refuses rather
than silently reading from a piped/redirected source, which could otherwise
bypass the "never printed/logged" guarantee. Accepts injectable
input/output streams for testing (same DI pattern as Phase E's
`CommandRunner`).

### Exit check: automated, not manual - and proven meaningful
Built `exit-check-zero-plaintext.test.ts`: stores one real secret value via
the real macOS keychain, runs it through a simulated install -> configure ->
activate flow touching every artifact type the brief calls out (a generated
client config file, the real SQLite lockfile/state from `@scopewatch/state`
scanned as raw bytes - not just the columns expected to matter - and log
output through the redacting logger), then greps every artifact plus every
file in the run's working directory for the raw value. Confirmed the test
is not a tautology by deliberately disabling redaction and re-running: it
correctly failed with `"PLAINTEXT SECRET LEAK in log output"`, then passed
again once redaction was restored.

### Real bug found and fixed during implementation: `@scopewatch/state`'s schema files were never copied to `dist/`
`db.ts` resolves its migrations directory relative to its own
`import.meta.url`. Every Phase C test ran against `.ts` source directly via
`tsx`, where that correctly points at `src/schema`. The exit-check test
above was the first thing in this codebase to consume `@scopewatch/state` as
a real *compiled* dependency (`import { openDatabase } from
'@scopewatch/state'`, resolving to `dist/index.js`) - which immediately
failed with `ENOENT: .../packages/state/dist/schema`, because nothing had
ever copied the `.sql` migration files into `dist/`. Root cause: the
top-level `prepare` hook runs `tsc --build` directly, which compiles `.ts`
files but has no notion of copying non-TypeScript assets - the same shape of
"invisible until actually consumed externally" bug as the build-hygiene fix
earlier in Phase C. Fixed by adding a `copy-schema` step to both
`packages/state`'s own `build` script and the root `build` script
(`tsc --build && npm run copy-schema --workspace=@scopewatch/state`),
verified by deleting all `dist/` and `.tsbuildinfo` files and confirming a
clean `npm install` produces `dist/schema/*.sql`.

Full suite: 96/96 passing (59 Phase A/B/C/E + 37 Phase D), verified offline
(broken-proxy check) and against a real, cleaned-up-afterward macOS
keychain. Windows path implemented but unverified on real hardware.

---

## Build-Verification Gap Fix (2026-09-06, pre-Phase F)

Every test through Phase D ran via `tsx` directly against `.ts` source. The
Phase D exit-check test was the first thing in this codebase to import
another package by name as a real compiled dependency
(`@scopewatch/state`), and that accident is what caught the missing
`dist/schema/*.sql` bug - nothing had verified any package's `dist/` output
before that. Confirmed `diff-engine` only ever imports `@scopewatch/manifest`
via `import type`, erased at compile time - manifest's `dist/` had never
been loaded by anything at all.

**Fix:** added one `dist-smoke.test.ts` per package (manifest, diff-engine,
state, install-adapters, secrets, and later client-adapters), each importing
its target BY PACKAGE NAME - forcing real resolution through
`package.json`'s `exports`/`main` into `dist/`, the same path any actual
consumer takes. Verified each is not a tautology: temporarily renamed each
package's `dist/` away in turn and confirmed the corresponding test (and
only that one) fails to resolve; restored and confirmed green again.

Also added `.github/workflows/ci.yml`: a build+test matrix across
ubuntu-latest, windows-latest, and macos-latest, plus a separate `test-e2e`
job. **This repository has no GitHub remote configured and `gh` is not
authenticated in this environment - the workflow has not been executed.**
It requires being pushed to a real GitHub repository before it produces any
actual result. Until then, the Windows secrets keychain path (Phase D)
remains verified only against documented Win32 API contracts, not a real
Windows runner - this is a known, stated gap, not a silent one.

Full suite: 102/102 passing (96 prior + 6 new dist-smoke tests).

---

## Phase F: Client Adapters ✅ (2026-09-06)

**Clients confirmed: Claude Code and Cursor** (the brief's default).

### Config formats and locations (cited from official docs, fetched live)
- **Claude Code** ([code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)): project scope is `.mcp.json` at project root - a dedicated, version-controllable file. User/local scope both live inside `~/.claude.json`, a single large file spanning every project on the machine plus non-MCP settings.
- **Cursor** ([cursor.com/docs/context/mcp](https://cursor.com/docs/context/mcp)): project scope is `.cursor/mcp.json`; global scope is `~/.cursor/mcp.json` - both appear MCP-dedicated (no evidence of unrelated Cursor settings mixed in).
- Both clients share an identical stdio shape: `{ "mcpServers": { "<name>": { "command", "args", "env" } } }`.

### Stated limitation: v1 is project-scope only
Scopewatch never writes to `~/.claude.json` or `~/.cursor/mcp.json` (global
scope) - those files are shared across every project and, for Claude Code,
mixed with unrelated settings, making them unnecessary risk for v1. **This
is an explicit MVP narrowing, not an oversight**: a developer who wants a
server available in every project they open has no path to that yet; they
must activate per-project. State this in `docs/` under "what activation
does and does not cover" so it's discovered from documentation, not
confusion.

### Ownership-tracked config writer (`client_config_ownership` table, migration 003)
Rather than heuristically diffing file content to guess "did a human write
this," Scopewatch tracks its own ownership explicitly: `(server_id,
client_id) -> (config_file_path, config_key)`. `config_key` is `server_id`
verbatim - no sanitization, since JSON object keys accept any string, and
`(server_id, client_id)` is already unique in `lockfile_entries`, so no
collision path exists by construction. A `UNIQUE(client_id,
config_file_path, config_key)` constraint guards this as defense-in-depth
regardless. On every write, `mergeConfig()` touches ONLY keys in the
tracked ownership set for that file - any other key, human-authored or
otherwise, is preserved untouched.

**Scope note, stated explicitly in code and here:** this protects other
people's keys from ever being touched (Phase F's job). It does **not**
detect drift within a key Scopewatch itself owns - if a human hand-edits
the `args` of an entry Scopewatch created, the ownership table still
considers that key "ours" and the next write overwrites the hand-edit with
zero detection. That's the client drift reconciler's job (**Phase H**), not
this one.

**Mutation-tested, not just asserted-clean:** temporarily replaced the real
merge with a naive `{ mcpServers: updates }` overwrite (discarding all
existing content) and re-ran the real suite - 6 of 12 tests correctly
failed, each with a real, specific assertion (e.g. "other owned entries
must survive," "unrelated entry untouched by the update"), not just "some
test broke." Restored the fix and confirmed green again.

### The `scopewatch-run` wrapper: bridging keychain secrets to a client-spawned process
The real problem: Scopewatch's Phase D secret injection only works when
Scopewatch itself spawns the process, but at actual runtime it's the
CLIENT (Claude Code/Cursor) that spawns the MCP server, not Scopewatch.
Generated configs point `command` at a small wrapper binary
(`scopewatch-run`, shipped in `@scopewatch/client-adapters`'s `bin/`)
instead of the real server directly - the wrapper resolves secrets from
the keychain and injects them into its own child's env, so the value never
touches the config file and the user never has to export anything into
their shell.

Three safety properties, each required before this wrapper could exist at
all (identified during design review, not discovered after the fact):

1. **State gate.** The wrapper runs OUTSIDE the CLI - the client invokes it
   directly, often on its own restart. Without checking
   `lockfile_entries.state` first, a client restart while an update sits
   unapproved (state `updated`, diff shown but not confirmed) would
   silently activate it the moment the client happens to respawn the
   process - a direct violation of "every diff shown before activation,
   never after." The wrapper refuses to launch unless state is exactly
   `active`, deferring entirely to what the lifecycle engine has already
   approved; it never independently decides what "current" means.
2. **Fail loud on secret retrieval failure.** Never execs the real server
   without its required secrets - a server launched without credentials
   fails downstream in a confusing, vendor-specific way with no link back
   to Scopewatch.
3. **Process relationship.** `spawn` with `stdio: 'inherit'` (not manual
   piping) - the real server shares the wrapper's stdio file descriptors
   directly, so MCP's JSON-RPC stdio protocol traffic is never touched or
   buffered by an extra hop, and this works identically on Windows and
   POSIX via Node's cross-platform API. Signals sent to the wrapper are
   forwarded to the child (`child.kill(sig)`); on the child's exit, the
   wrapper propagates the exact same exit code, or - if the child died from
   a signal - re-raises that same signal on itself so the parent sees
   accurate signal-based termination status (the standard `tini`/`dumb-init`
   pattern).

**Verified for real, not just via mocked call-tracking:** a real-process
test suite (`run-wrapper-real-process.test.ts`) spawns an actual local
fixture script (`fake-mcp-server.mjs`) through the real
`node:child_process.spawn` - not an injected fake - and confirms: exit
code 0 and exit code 42 both propagate exactly; a real OS `SIGTERM` sent to
the wrapper's registered handler causes the wrapper to call the real
child's `kill('SIGTERM')`, and the fixture's own stdout output
(`"fake-mcp-server received SIGTERM"`) proves the real child process
genuinely received and handled a real OS signal, not a simulated one.

**Mutation-tested the state gate too:** disabled the `if (state !==
'active')` check, re-ran the state-gate test - it failed (the mutation
caused `spawn` to be invoked when it should have been forbidden, hanging
the test on a fake child that never emits `exit`, correctly flagged as a
failure by the test runner). Restored and confirmed green.

Full suite: 123/123 passing (102 prior + 21 new: config-writer,
run-wrapper unit + real-process, activate, dist-smoke).

### MVP acceptance criterion, proven end-to-end (not inferred from components)

Section 19 of the brief requires: *"The same server definition activates
correctly for both supported clients without duplicating credentials or
hand-editing."* The component-level tests above proved the pieces work;
they didn't prove the whole chain, for both clients, from one manifest.
Closed with `golden-path-both-clients.test.ts` (3 tests):

1. **Fail-loud secret retrieval, confirmed already real** (not newly added -
   `run-wrapper.test.ts`'s existing test declares `MISSING_TOKEN` in a
   manifest and never calls `storeSecret` for it, so the failure comes from
   a genuine real-keychain "not found" lookup, not a mock).
2. **One manifest, both clients, real launch.** Activates `golden-path-server`
   on both Claude Code and Cursor from one manifest; confirms each client's
   config file exists at its documented path in its documented shape, the
   ownership table tracks each independently, and - critically - reads the
   exact `(server_id, client_id)` args back OUT of each client's config file
   and feeds them into `runWrapper`, proving the specific args a real client
   would invoke actually launch the real fixture successfully, for both
   clients independently (not one mechanism verified once and assumed to
   generalize to the second).
3. **Secret sharing, not duplication, proven directly.** Stores exactly one
   keychain entry, confirms via a real `security find-generic-password` call
   that exactly one entry exists for that reference, then drives both
   clients' wrapper invocations and confirms both retrieve the identical
   value. `secretRef()` takes no `client_id` parameter at all, so a second
   client's activation cannot mint a second keychain entry even in
   principle - proven here, not just inferred from the reference format.

**Mutation-tested this too:** temporarily dropped `injectResult.env` from the
spawned process's env (secret silently never injected) and reran - both the
launch test and the secret-sharing test failed with specific assertions
("the shared secret must be injected into the spawned env", "Claude Code's
wrapper invocation retrieved the shared value"), not a generic crash.
Restored, confirmed green, confirmed the real macOS keychain was left clean
of test artifacts.

Full suite: 126/126 passing (123 prior + 3 new).

---

## Phase G (in progress): Capability Inference ✅

Before wiring the CLI, Phase G surfaced a real gap: no phase had built a way
to turn a real MCP server's `tools/list` response into `CapabilityEntry[]`
for the diff engine. The MCP registry API gives `environmentVariables` (maps
to `SecretDeclaration`) but nothing resembling verbs/resources.

**Design validated against real, live data before writing implementation
code**: ran `@modelcontextprotocol/server-filesystem` for real via
`npx`, performed a real MCP stdio JSON-RPC handshake, and captured its
actual `tools/list` response (14 real tools, saved as
`packages/capability-inference/test/fixtures/real-filesystem-server-tools.json`)
- not invented examples. This surfaced that MCP tools can carry optional
self-reported `annotations` (`readOnlyHint`, `destructiveHint`,
`idempotentHint`) - a far stronger signal than description-keyword-matching
alone.

### Ruleset (`packages/capability-inference`, its own package with its own fixture matrix, matching `diff-engine`'s precedent)
1. `destructiveHint:true` → destructive pool; keyword refines to `delete`/`execute`/`write` if found, **else defaults to `delete`** (not `write` - a deliberate reconsideration: `destructiveHint:true` is the server's own admission of real consequence, and defaulting to the mildest destructive option when genuinely uncertain contradicts the project's posture since Phase B of erring toward showing more risk, not less).
2. `readOnlyHint:true` → non-destructive pool; keyword refines to `fetch` if found, else `read`.
3. Both hints `false` → keyword wins if found, else `write`.
4. No annotations at all → keyword wins if found, else conservative `execute` fallback.
5. **Severity-override (applies universally, after 1-4)**: severity(read=0, fetch=1, send=1, write=2, delete=3, execute=3) - if keyword evidence is strictly more severe than the annotation-derived verb, keyword wins, with a warning recorded. A server's self-reported hint cannot silently suppress an alarming signal sitting in its own tool's name/description.
6. **Contradiction flagging**: `destructiveHint:true && readOnlyHint:true` simultaneously is recorded as a warning regardless of resolution (destructive pool wins, but the self-contradiction is surfaced, not silently absorbed).

`move`/`rename` deliberately excluded from the write-keyword list: a
relocation both creates at the destination and vacates the source, closer
to a delete-shaped effect at the origin than a confident write signal - so
`move_file` (real tool, `destructiveHint:true`, no other keyword match)
correctly falls through to the new delete default, not write.

Resource inference scans **only** `inputSchema` parameter names/descriptions
(`path`→`filesystem:*`, `repo`→`repo:*`, `url`→`http:*`, else the honest `*`
wildcard) - deliberately not the tool's free-text description.

### Three real bugs found and fixed via validation against real data (not invented edge cases)
1. **Resource over-matching**: `list_allowed_directories`'s description casually mentions "nested **paths**" without the tool taking any path parameter - scanning the full description (not just schema properties) produced a falsely specific `filesystem:*` instead of the honest `*`. Fixed by scanning only parameter data.
2. **Conjugation gap**: `\bdelete\b` does not match "**deletes**" (no word boundary between "delete" and the trailing "s") - a synthetic override-rule test failed because of this before it ever reached the interesting logic. Fixed with left-anchored stem matching for longer/distinctive words, exact whole-word matching retained for short/common words (`run`, `call`, `get`) that would otherwise false-positive on unrelated words (`runtime`, `callback`, `getter`).
3. **Noun/verb ambiguity, found twice via real metadata boilerplate**: `read_text_file`'s "detailed error **messages**" false-triggered `send` (a stray `messag` stem); `get_file_info`'s "**creation** time" and "last **modified** time" - extremely common timestamp-field phrasing - false-triggered `write` via bare `creat`/`modif` stems. Both fixed by requiring exact conjugated verb forms for these specific words instead of a bare stem, since the noun/adjective usage ("creation time" as a field name) is far more common in real tool descriptions than the verb usage for these particular words.

All three were only found because the ruleset was validated against a real,
live server's real output before and during implementation - not because
they were anticipated in the design pass.

**Fixture matrix** (12 tests): all 9 real read-only tools, `write_file`/`edit_file` (real, destructive+write-keyword), `create_directory` (real, both-hints-false), `list_allowed_directories`'s wildcard-resource case (real, no path param), the `move_file` ambiguous case (real, documented reasoning in both code and test), the contradiction fixture (synthetic, both hints true), the override fixture (synthetic, declared-safe hint contradicted by a "permanently deletes" description), two no-annotations-at-all fixtures (pure keyword fallback, and genuine no-signal fallback), a provenance-tagging check across all real tools, and a snake_case tokenization regression test.

Full suite: 139/139 passing (126 prior + 13 new: 12 inference tests + 1 dist-smoke).

### Follow-up hardening: name-first classification, conjugation audit, and an honest limit on how far either goes

Post-review, three further changes:

1. **Name-first classification for the "which flavor" decision.** A tool's
   name is terse and verb-led by convention (`read_file`, `write_file`) with
   none of the incidental nouns/adjectives that description prose carries.
   Checking the name alone first, before ever touching the description, for
   branch decisions (e.g. delete vs execute vs write within the destructive
   pool) structurally prevents most of the noun/verb ambiguity that produced
   the two bugs above.

2. **This alone was proven NOT sufficient** - verified directly, not
   assumed: temporarily reverted the `messag`/`creat`/`modif` word-specific
   exclusions while keeping name-first in place, and `read_text_file`'s
   "detailed error messages" reappeared as a false `send` classification -
   just via a different path than before. The severity-override rule (which
   exists specifically so a calm-sounding name, like a hypothetical
   `benign_reader` whose description says it "permanently deletes"
   something, can't suppress a real danger signal) must scan the *full*
   name+description text by design, and that full-text scan is exactly
   where the same ambiguity can re-enter. **Both the name-first structure
   and the word-specific exclusions are load-bearing; neither alone is
   sufficient** - this is stated explicitly in `infer.ts`'s module doc
   comment, including the exact revert-and-reproduce steps that proved it,
   so a future reader doesn't assume the structural fix alone closed the
   class of bug.

3. **Conjugation audit across every keyword category**, not just the
   `delete` list that broke first: added `sent` (irregular past tense of
   send; guarded against colliding with "sentence"/"sentiment") and `found`
   (irregular past tense of find; guarded against colliding with
   "foundation") as exact whole-word forms. Rarer irregulars (ran, got,
   gotten, ate) are deliberately left unaddressed and documented as a known
   gap rather than exhaustively chased - diminishing returns for a
   heuristic system.

Re-validated against all 14 real tools after every change (zero warnings on
this well-behaved real server; `move_file`'s resource correctly falls to
the honest `*` wildcard rather than `filesystem:*`, since its `source`/
`destination` parameters have no description and don't match the path-
keyword patterns - a defensible outcome, not a bug).

Full suite: 139/139 passing (unchanged count - this was a correctness
hardening pass, not new fixtures).

### The actual resolution: narrowing the override's scope to match its stated purpose

The tension above (name-first vs. the override needing full-text scanning)
had a real fix, not just a documented tradeoff. The override's job is
narrow: "is this tool secretly destructive despite a calm name/hint" - not
"does the full text contain any keyword at all." It was scanning against
all six categories, which is strictly broader than that job requires, and
that excess breadth was the exact path `read_text_file`'s stray `send`
match reappeared through. Narrowed `matchDangerousKeyword` to scan the full
text against **only the delete/execute patterns** - the two categories the
override actually exists to catch.

**Verified this genuinely closes the gap, not just moves it**: with both
defenses in place (name-first + the narrowed override), temporarily
reverted *every* word-specific exclusion in `KEYWORD_PATTERNS`
(`messag`/`creat`/`modif` exclusions, `sent`/`found` additions) and reran
the full 12-test fixture matrix - all 12 passed, including the two tests
(`read_text_file`'s classification, the `benign_reader` override fixture)
that had specifically broken in earlier iterations. That is the actual
test of whether this closed the class of bug: not whether it passes with
the patches in place, but whether the patches became unnecessary. They
did. Restored them anyway as defense-in-depth for the one remaining path
they still matter on (a generically-named tool with no name-first match
still falls back to a full six-category scan for its default
classification) - but they are no longer load-bearing for the two cases
that originally broke.

Full suite: 139/139 passing (same fixture count; this was a correctness
narrowing, not new fixtures).

---

## Phase G: CLI Surface ✅ (2026-09-06)

New `apps/cli` (`@scopewatch/cli`, bin: `scopewatch`), wiring all commands to
existing modules per the approved design. Most commands are thin; two
required genuinely new logic:

- **Registry client** (`registry-client.ts`): the live-verified
  `registry.modelcontextprotocol.io` endpoints from the design phase -
  `GET /v0.1/servers?search=` and `GET /v0.1/servers/{url-encoded name}/versions/{version}`
  - with `network_unreachable`/`server_not_found`/`registry_error`
  categorization, same pattern as Phase E's install errors.
- **`mcp-client.ts`**: the baseline real JSON-RPC-over-stdio handshake
  (`initialize` → `tools/list`), shared by `install` (to get real tool data
  for capability inference) and `test`. Four categorized failures:
  `spawn_failed`, `handshake_timeout`, `malformed_response`,
  `protocol_error`. Deliberately minimal per the design - sanitized log
  capture and deeper failure taxonomies are Phase I's job.

`install` orchestrates the full pipeline for the first time: registry fetch
→ manifest built with **real** inferred capabilities (via
`@scopewatch/capability-inference`, from a real handshake against the
freshly-installed package - not a placeholder) → lifecycle transitions
through `discovered → reviewed → installed → configured → validated` →
secret prompting for each required credential. `activate` does
`validated → active` + writes the real client config.
`update`/`update --check`/`diff`/`rollback`/`status` wire directly to
`@scopewatch/diff-engine` and `@scopewatch/state` as mapped. `drift` is the
approved stub (reports "not yet implemented," never a crash).

### The exit check found a real integration bug immediately

Built Journey A as one real scripted sequence (`journey-a.test.ts`) against
a fixtured registry and a fixtured-but-protocol-real MCP server (speaks
actual JSON-RPC over stdio, not a mock) - `search → info → install → test →
activate → update --check → update → diff → approve` - not isolated
per-command unit tests. First run failed immediately:

`install`'s handshake call passed `{}` as the child process's `env`,
stripping `PATH` entirely - so `node` (or `npx`) couldn't be resolved via
PATH lookup, `spawn_failed` with `ENOENT`. Every phase-level test up to
this point either used a fully-injected fake spawn (no real env dependency)
or ran commands directly with `process.env` already correctly threaded
through by the caller - `install`'s own new orchestration code was the
first place this specific path (env passed into a nested real-process
spawn several layers down) was ever actually exercised end-to-end. Fixed
by threading `process.env` through at all three call sites
(`mcpHandshakeAndListTools` in `install`, `test`, and `update`). Exactly
the kind of integration gap the exit check exists to catch before Phase H
builds more on top of it.

After the fix, Journey A passes with real, checkable state at every step:
real inferred capabilities in the built manifest (`read_record`→`read`,
`write_record`→`write`, both `provenance: 'inferred'`), the real secret
prompt firing and the value landing in the real macOS keychain, lifecycle
state advancing to exactly `validated` after install (not further), a real
`.mcp.json` file written on `activate`, a real diff (`computeDiff` against
two real inferred manifests) correctly flagging a genuinely new destructive
tool as `newly_destructive: true` / `riskLevel: 'high'` on update, state
correctly stopping at `updated` (never auto-activating) until the explicit
approve step moves it to `active`.

Full suite: 150/150 passing (139 prior + 1 Journey A + 5 registry-client +
5 mcp-client), verified offline (broken-proxy check) and from a clean
rebuild. Also smoke-tested the compiled `scopewatch` binary directly
(`--help`, `doctor`) - `doctor` correctly and honestly reports this dev
machine's Node 21.7.1 as below the 22.0.0 floor, the same real finding as
Phase E, not silently worked around.

### Critical follow-up fix: the env fix reopened the problem this product exists to prevent

Threading `process.env` through to fix the ENOENT bug was itself a real
security regression, caught in review: `mcpHandshakeAndListTools` runs
during `install`/`test`/`update` - **before** the user has seen a
capability diff or approved anything. Handing that spawn the CLI's full
ambient environment meant an unreviewed, not-yet-approved server could read
every unrelated credential in the user's shell (other API keys, cloud
tokens, anything) during its very first run - turning the test/handshake
step itself into an exfiltration opportunity, inside the one product whose
entire premise is knowing exactly what a tool can access.

**Fix** (`minimal-env.ts`): built a deliberately minimal environment
following the same philosophy as `scopewatch-run` (Phase F) - `PATH` (the
actual fix needed) plus platform-baseline variables Node/npm genuinely
require (`HOME`/`TMPDIR` on POSIX; `USERPROFILE`/`SystemRoot`/`TEMP`/`TMP`/
`APPDATA`/`PATHEXT` on Windows), plus - only when applicable - the
*specific* secrets this server's own manifest declares, retrieved via the
same `secretRef`-based keychain path the wrapper uses. Never a wholesale
copy of `process.env`.

Applied per call site with different secret availability, each reasoned
through explicitly rather than treated as one uniform fix:
- **`install`'s handshake**: no secrets injected at all - at this point in
  the pipeline nothing has been prompted/stored yet (that happens later, at
  the `configured` transition). A server that genuinely requires a secret
  just to start may fail this handshake; documented as an honest, expected
  outcome, not a bug to route around by reordering the lifecycle to prompt
  earlier than designed.
- **`test`**: injects only this server's own already-stored secrets
  (`collectAvailableSecrets`, best-effort - a missing secret is simply
  omitted, since this is diagnostic, not activation).
- **`update`**: injects the *current* (already-active) manifest's stored
  secrets, since the new version is being test-handshaked against the
  existing setup before any diff is shown.

**Verified, not assumed**: mutation-tested `minimalSpawnEnv` itself
(temporarily made it spread `process.env` back in) and confirmed 3 of 5
tests correctly failed with specific assertions ("an unrelated real
environment variable must never leak into the spawn env"), then restored
and confirmed green. Added a dedicated test
(`cmd-test-minimal-env.test.ts`) proving `cmdTest`'s actual real spawn env
contains this server's own secret plus the baseline and nothing else - not
inferred from `minimalSpawnEnv`'s unit tests alone. Re-ran Journey A after
the fix to confirm the narrower environment still resolves the original
ENOENT (it does - `PATH` alone was always the actual requirement).

Full suite: 156/156 passing (150 prior + 6 new), verified offline and from
a clean rebuild, real macOS keychain confirmed clean.

---

## Phase H: Client Drift Reconciler ✅ (2026-09-06)

### Design correction before implementation: snapshot, not regeneration

Original sketch compared the live config against a value *regenerated* from
the current manifest + `activateForClient`'s logic at drift-check time.
Caught before implementation: this couples detection's correctness to that
generation logic staying byte-for-byte stable forever - any future
refactor, bug fix, or formatting change would make every previously-
activated server look "drifted" the next time anyone ran `drift`, with no
real drift having occurred. **Fixed**: added `last_written_value` to
`client_config_ownership` (migration 004), storing the exact serialized
entry at the moment `activateForClient` writes it. Detection compares the
live file against *that stored snapshot* - never a freshly regenerated
value - making it immune to any future change in how config gets
generated.

### A second, more serious issue found in the same review: the naive backfill was a data-loss hazard

Initial migration design backfilled pre-existing ownership rows with
`last_written_value = '{}'`, reasoning "it'll show as drifted, which is
honest." Traced through what actually happens next: a user sees that
falsely-flagged entry, picks "restore Scopewatch's version," and
`JSON.parse('{}')` gets written into their file - **silently blanking out
their real, working server configuration**, because the "snapshot" being
restored was never a real historical value. Not a cosmetic false positive;
a destructive action the design would have made available with no guard.

**Fixed**: `last_written_value` is nullable; migration 004 backfills `NULL`
for pre-existing rows (a pure DB transformation - no filesystem access from
inside the migration). A fourth `DriftStatus`, `'unverifiable'`, is
reported for `NULL`-snapshot rows - distinct from `'changed'`, which would
imply a real prior value exists to compare against or restore. `resolveDriftEntry`
**refuses `'restore'` entirely for `'unverifiable'`** with a clear error;
the only valid resolution is `'keep'` (adopt the current live value - or,
if the key is also absent, transition to `disabled` - as the new baseline).
The interactive CLI prompt only ever offers resolutions `validResolutionsFor()`
actually allows, so `'restore'` is never presented as a choice for this
status in the first place.

### Detection: four statuses (`packages/client-adapters/src/drift.ts`)

`unchanged` / `changed` / `missing` / `unverifiable`, per owned config key,
per `(server_id, client_id)` pair. Validates the file's top-level structure
*before* attempting per-key comparison - unparseable JSON or a restructured
`mcpServers` (not an object) surfaces as `malformed_config_structure`, a
distinct, more severe error category, never forced into the four-status
model.

### Resolution: two real commands, not detection-with-resolution-deferred

Committed to building both now, not leaving resolution as a hypothetical
future flag - Journey C's "offered a merge, not a silent overwrite"
requires an actual path to act on what's found, in this phase:
- **`scopewatch drift --all-clients`** - read-only report, no writes.
- **`scopewatch drift --resolve`** - interactively prompts keep/restore/skip
  per drifted entry and applies immediately, including the real
  `active → disabled` lifecycle transition (via `LifecycleEngine`'s actual
  intent/confirm mechanism, not a raw `UPDATE`) when a user confirms a
  removed entry should stay removed - otherwise `status` would report
  `active` for a server no longer actually wired into the client at all.

Restoration reuses the exact `mergeConfig`/`writeConfigFile` pipeline
`activateForClient` already built and tested - not a second parallel
implementation of "write this key without touching others."

### Mutation-tested, per the established standard

Broke `restoreEntry` into a naive full-file overwrite (discarding
everything else) and reran the suite: the `changed + restore` fixture
correctly failed with "unrelated human entry must survive a restore," not
a generic crash. Restored, confirmed green.

### Fixture matrix (15 tests: `drift.test.ts` ×8, `drift-resolve.test.ts` ×7)

All three real detection cases plus the explicitly-required `unverifiable`
case (simulating a pre-migration row directly, confirming it reports
`unverifiable` not `changed`); a human-added unrelated entry proven
untouched; both malformed-structure paths (unparseable JSON, non-object
`mcpServers`); independent per-client detection across Claude Code and
Cursor for one server; every resolution combination including the
mutation-tested restore, the real `active→disabled` transition, and the
dedicated `unverifiable`-restore-refused fixture confirming the real file
on disk survives a refused restore attempt untouched.

### Exit check: Journey C run as one real scripted sequence, not isolated units

`journey-c.test.ts` (2 tests): activate for real → a human hand-edits the
*real* file on disk (not a simulated in-memory change) → `drift
--all-clients`-equivalent report finds the real mismatch and confirms
reporting alone wrote nothing → `drift --resolve`-equivalent applies the
user's real choice (`restore` in one test, `keep`-the-removal in the other)
→ confirms the real file reflects the choice, the unrelated human entry
survived the entire journey, and re-running detection afterward reports
`unchanged` - the loop actually closes, not just one pass through it.

Full suite: 173/173 passing (156 prior + 15 detection/resolution + 2
Journey C), verified offline, from a clean rebuild, and dist-smoke
re-confirmed meaningful via the established delete-dist technique.

---

**Last updated:** 2026-09-06 (Phase A ✅, Phase B ✅, Phase C ✅, Phase D ✅, Phase E ✅, Phase F ✅, Phase G ✅, Phase H ✅ complete)  
**Commits:** 19 (Phase A + Phase B implementation/fixes + Phase C lifecycle engine/fixes + build infra fix + Phase E install adapter + phase labeling fix + Phase D secrets + dist-smoke build-verification fix + Phase F client adapters + Phase F golden-path proof + Phase G capability inference + Phase G inference hardening + Phase G override narrowing + Phase G CLI surface + Phase G minimal-env security fix + Phase H drift reconciler)
