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

## Current Phase: A — Manifest & Schema Foundation

### Phase A Checklist
- [ ] Zod schema implementation for ServerManifest
- [ ] Validation error messages (readable, specific, not raw Zod dumps)
- [ ] Migration system for schema version bumps
- [ ] Test fixtures: valid manifest, malformed manifest (various error types)
- [ ] Round-trip test: parse → serialize → parse with no data loss

### Phase A Exit Check
A hand-written malformed manifest fixture produces a clear, specific validation error. A valid manifest round-trips with no data loss. Do not proceed to Phase B until this is genuinely true.

## Deviations from Brief (none yet)

---

**Last updated:** 2026-09-06 (scaffolding)  
**Current session focus:** Phase A — Manifest Schema & Validation
