# Scopewatch

[![CI](https://github.com/PuttaSathvik16/scopewatch/actions/workflows/ci.yml/badge.svg)](https://github.com/PuttaSathvik16/scopewatch/actions/workflows/ci.yml)

A local-first, CLI-only trust layer for MCP servers and AI agent tools.

On every install and update, Scopewatch produces a correct, plain-language
**capability diff** showing exactly what a server can read, write, send,
delete, or execute — compared to the last time you approved it. That diff is
always shown **before** the new version is activated, never after.

That one moment — an honest diff you see before anything changes — is the
entire product. Everything else in this repository exists to support it.

## Table of contents

- [Why](#why)
- [What it does](#what-it-does)
- [What it doesn't do (v1)](#what-it-doesnt-do-v1)
- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Quickstart](#quickstart)
- [Command reference](#command-reference)
- [Project structure](#project-structure)
- [Documentation](#documentation)
- [Development](#development)
- [Testing](#testing)
- [Security model, in short](#security-model-in-short)
- [License](#license)

## Why

MCP servers and agent tools can silently gain new capabilities on update — a
filesystem reader can become a filesystem writer, a read-only GitHub tool can
start deleting repositories, a server with no network access can start
sending data externally. Most install flows show you a version number and a
changelog, if anything. Neither tells you what actually changed about what
the tool can *do* to your machine or your accounts.

Scopewatch tracks capabilities at the resource level, across versions, and
surfaces exactly what changed in plain language — so capability changes get
approved deliberately, not discovered after the fact.

## What it does

- **Infers real capabilities** (`read`, `fetch`, `send`, `write`, `delete`,
  `execute`) per tool, per resource, from a server's actual declared tool
  data (name, description, input schema, and any self-reported annotations
  like `destructiveHint`) — not from trusting the server's own marketing.
- **Computes a structured, four-tier capability diff** between the version
  you have and the version you're about to install:
  1. Categorical acquisition — a tool goes from read-only to having any of
     write/delete/execute (loudest signal, gates `newly_destructive`)
  2. Scope expansion — an already-destructive tool's reach widens
  3. Scope narrowing — reach shrinks (safe, but still shown)
  4. Cosmetic — description-only changes
- **Tracks a parallel credential diff** (new secret required / existing
  secret reused / secret removed / secret's `required` flag flipped
  false→true), because a new tool reusing a secret you already trusted is a
  materially different risk than one that demands a brand-new credential.
- **Never auto-activates an update.** The diff is rendered, and activation
  only proceeds after explicit approval — an interactive `y/N` prompt for
  real usage, never a background write.
- **Stores secrets in your OS's real keychain** (`security` on macOS,
  `secret-tool`/libsecret on Linux, Windows Credential Manager via
  PowerShell) — never in a config file, lockfile, or log. Values are
  redacted from every log path, content-based, not just by key name.
- **Writes client config without stepping on your own edits.** Config
  writes are ownership-tracked per key; Scopewatch only ever touches keys it
  itself created, and can detect drift if you hand-edit something it wrote.
- **Fails loud, with a recovery path.** Every error surfaces through a
  categorized taxonomy (e.g. `node_version_too_old`, `network_unreachable`,
  `no_keychain_backend`) with an actionable message — never a raw stack
  trace or a silent no-op.

## What it doesn't do (v1)

These are stated, deliberate scope cuts for v1 — not oversights:

- No server catalog or curation — point it at the official MCP registry
- No dashboard or GUI — CLI only
- No profiles, team sharing, or multi-user workflows
- No crowdsourced compatibility matrix, no runtime policy guard
- No Docker/container install path — npm/npx is the only install adapter
- Two agent clients supported: **Claude Code** and **Cursor**
- **Project scope only** for client config — Scopewatch never writes to
  global config shared across every project on your machine (see
  [docs/supported-matrix.md](docs/supported-matrix.md))

## How it works

```
scopewatch install <server>
        │
        ▼
  fetch manifest from the MCP registry
        │
        ▼
  real handshake against the server (JSON-RPC over stdio) → tools/list
        │
        ▼
  infer capabilities per tool (declared hints + keyword/name analysis)
        │
        ▼
  prompt for any required secrets → store in OS keychain
        │
        ▼
  lifecycle: discovered → reviewed → installed → configured → validated
        │
        ▼
scopewatch activate <server>
        │
        ▼
  write client config (ownership-tracked, never touches unrelated keys)
        │
        ▼
        active

scopewatch update <server>
        │
        ▼
  compute a real capability diff against the currently-active manifest
        │
        ▼
  render the diff — plain language, severity-ordered, grouped by tool
        │
        ▼
  ⏸  wait for explicit approval (never auto-activate)
        │
        ▼
  approved → activate new version   |   declined → stays on current version
```

## Requirements

- Node.js **>= 22.0.0**
- One of the following for OS keychain access:
  - macOS — `security` (ships with the OS)
  - Linux — `secret-tool` (from `libsecret-tools`; needs a running Secret
    Service, e.g. GNOME Keyring)
  - Windows — PowerShell (ships with the OS)

Run `scopewatch doctor` any time to check whether your environment meets
these requirements.

## Quickstart

```bash
npm install -g scopewatch

scopewatch doctor                    # verify Node/npm meet requirements
scopewatch search <term>             # find a server in the MCP registry
scopewatch info <server>             # show details for a specific server
scopewatch install <server>          # install, infer capabilities, prompt for secrets
scopewatch test <server>             # verify the server actually starts and responds
scopewatch activate <server>         # write client config for this project
scopewatch status                    # see everything installed and its state
scopewatch update <server>           # review a capability diff, approve, activate
scopewatch update <server> --check   # just check whether a newer version exists
scopewatch diff <server>             # re-show the last computed diff
scopewatch rollback <server>         # revert to the last known-good version
scopewatch deactivate <server>       # remove from client config (leaves other entries untouched)
scopewatch drift --all-clients       # check for hand-edits to Scopewatch-owned config
scopewatch drift --resolve           # interactively keep/restore drifted entries
```

See [docs/quickstart.md](docs/quickstart.md) for a full walkthrough with
expected output at each step.

## Command reference

| Command | What it does |
|---|---|
| `doctor` | Checks Node/npm versions against the required floor |
| `search <term>` | Searches the MCP registry |
| `info <server>` | Shows registry details for one server |
| `install <server>` | Installs, infers capabilities, prompts for secrets |
| `test <server>` | Real connection test — success or a categorized failure |
| `activate <server>` | Writes client config for the current project |
| `deactivate <server>` | Removes the server's entry from client config only |
| `status` | Lists every installed server and its lifecycle state |
| `diff <server>` | Re-shows the last computed capability diff |
| `update [server] [--check]` | Checks for/computes/approves an update |
| `rollback <server>` | Reverts to the last known-good version |
| `drift [--all-clients] [--resolve]` | Detects and optionally resolves config drift |
| `init` | Initializes local Scopewatch state |

Every command accepts `--client <id>` to target a specific client
(`claude-code` or `cursor`); it defaults to Claude Code.

## Project structure

```
scopewatch/
  apps/
    cli/                    # command parsing, terminal UX, orchestration (@scopewatch/cli)
  packages/
    manifest/                # Zod schema, validation, manifest types
    capability-inference/    # turns real MCP tool data into CapabilityEntry[]
    diff-engine/              # capability diff computation and plain-language rendering
    local-api/                # typed service layer used by the CLI
    state/                    # SQLite repositories, migrations, lockfile handling
    secrets/                  # OS keychain abstraction, redaction, secure prompting
    client-adapters/          # Claude Code + Cursor config writers, drift detection/resolution, scopewatch-run wrapper
    install-adapters/         # npm/npx install adapter, categorized failure detection
  docs/                    # quickstart, security model, supported matrix, inference limits
  e2e/                     # real-registry / real-npm smoke tests (separate cadence from unit tests)
  fixtures/                # (see each package's own test/fixtures/) versioned test manifests
  .github/workflows/       # CI (build + test matrix across macOS/Linux/Windows)
  CLAUDE.md                # internal build log: every phase, every decision, every bug found
```

Each `packages/*` module is independently testable and has its own
`test/` directory and (where relevant) its own `fixtures/`. The CLI in
`apps/cli` is the only place these packages are wired together into a
runnable product.

## Documentation

- [docs/quickstart.md](docs/quickstart.md) — full walkthrough
- [docs/security-model.md](docs/security-model.md) — secrets, keychain,
  redaction, process isolation
- [docs/supported-matrix.md](docs/supported-matrix.md) — supported clients,
  install adapters, and known scope limits
- [docs/capability-inference-limits.md](docs/capability-inference-limits.md) —
  how capability inference works and where it can be wrong

## Development

This is a TypeScript/Node.js monorepo using npm workspaces and TypeScript
project references (each package builds independently into its own
`dist/`).

```bash
npm install       # installs deps for every workspace package
npm run build     # tsc --build across all packages, topologically ordered
npm test          # runs the full unit + integration suite
npm run test:e2e  # runs real-registry / real-npm tests (separate, slower cadence)
```

Contribution notes:

- Every package that's consumed by name elsewhere has a `dist-smoke` test
  confirming it resolves correctly through its real `package.json`
  `exports`/`main`, not just via `.ts` source during tests.
- See [CLAUDE.md](CLAUDE.md) for the full history of design decisions, every
  phase's exit checks, and every real bug found during verification —
  useful context before touching `diff-engine`, `secrets`, or
  `client-adapters` in particular, since each has non-obvious constraints
  documented there.

## Testing

CI runs the full suite on every push and pull request, across all three
platforms Scopewatch claims to support — not just the fast path:

| Job | What it verifies |
|---|---|
| `test (ubuntu-latest)` | Full suite against a real, provisioned Secret Service (gnome-keyring) — the Linux keychain path is genuinely exercised, not skipped |
| `test (windows-latest)` | Full suite on real Windows, including the PowerShell-backed Credential Manager path |
| `test (macos-latest)` | Full suite against this project's primary development platform, including the real macOS keychain |
| `test-e2e` | Real npm registry install, on a separate, less frequent cadence |

A few things this suite specifically guards against, each because a real
bug slipped through before the check existed:

- **`dist-smoke` tests per package** — each package is imported by its
  published name (forcing real `dist/` resolution through its actual
  `package.json` `exports`/`main`), not by relative path to `.ts` source.
  This is what would have caught Phase D's schema-files-never-copied-to-
  `dist/` bug before it shipped.
- **A real, spawned-subprocess Journey A test** — the actual compiled CLI
  binary, invoked with real argv/stdio/env, through
  `install → test → activate → update → diff`. Direct function-call tests
  had previously let the entire `update`/`diff`/`approve` command surface
  ship unregistered in the CLI's entry point without anyone noticing; this
  is the layer that would catch that class of gap again.
- **Platform-specific keychain tests are gated to the platform they
  actually exercise** (`security` only runs where `security` exists), so a
  test failing on the "wrong" OS is a real signal, not noise to ignore.

Windows real-subprocess coverage for the Journey A test above is a known,
stated gap (its isolation strategy — POSIX shell shims, a Python-`pty`-based
pseudo-terminal — is POSIX-only by construction); the underlying commands
it exercises are still fully proven on macOS and Linux, and this is
documented in [CLAUDE.md](CLAUDE.md) rather than silently skipped.

## Security model, in short

- Secret **values** never touch a manifest, the SQLite state, a client
  config file, or a log — only a secret's `id` (e.g. `GITHUB_TOKEN`) is ever
  recorded. Values live in the OS keychain and, briefly, in memory during
  retrieval and injection into a spawned process's environment.
- A server that hasn't been reviewed and approved yet never receives your
  full shell environment during install-time testing — only `PATH` and
  platform-baseline variables, plus (only where applicable) that server's
  own already-stored secrets.
- Full details: [docs/security-model.md](docs/security-model.md).

## License

MIT
