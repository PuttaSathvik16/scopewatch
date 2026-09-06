# Scopewatch

A local-first, CLI-only trust layer for MCP servers and AI agent tools.

On every install and update, Scopewatch produces a correct, plain-language
**capability diff** showing exactly what a server can read, write, send,
delete, or execute — compared to the last time. That diff is always shown
**before** the new version is activated, never after.

## Why

MCP servers and agent tools can silently gain new capabilities on update —
a filesystem reader can become a filesystem writer, a read-only GitHub tool
can start deleting repos, a server with no network access can start sending
data externally. Scopewatch tracks capabilities at the resource level across
versions and surfaces exactly what changed, so you approve capability
changes deliberately instead of discovering them after the fact.

## What it does

- Infers and tracks capabilities (`read`, `fetch`, `send`, `write`, `delete`,
  `execute`) per tool, per resource, from a server's real declared tool data
- Computes a four-tier capability diff between versions (categorical
  acquisition, scope expansion, scope narrowing, cosmetic) and a parallel
  credential diff (new/reused/removed/required-changed secrets)
- Never activates an update until you've seen the diff and approved it
- Stores secrets in your OS keychain — never in a config file, lockfile, or
  log
- Writes client config (Claude Code, Cursor) without ever touching
  human-authored entries it doesn't own, and detects drift if you hand-edit
  a config it wrote
- Every error is categorized and actionable, with a safe default and a
  recovery path

## What it doesn't do (v1)

- No server catalog or curation — point it at the official MCP registry
- No dashboard or GUI — CLI only
- No profiles, teams, or multi-user workflows
- No Docker/container install path — npm/npx only
- No global/user-scope client config — project scope only (see
  [docs/supported-matrix.md](docs/supported-matrix.md))
- Two agent clients supported in v1: Claude Code and Cursor

## Requirements

- Node.js **>= 22.0.0**
- macOS (`security`), Linux (`secret-tool` / `libsecret-tools`), or Windows,
  for OS keychain access

## Quickstart

```bash
npm install -g scopewatch

scopewatch doctor              # verify Node/npm meet requirements
scopewatch search <term>       # find a server in the MCP registry
scopewatch install <server>    # install, infer capabilities, prompt for secrets
scopewatch test <server>       # verify the server actually starts and responds
scopewatch activate <server>   # write client config for this project
scopewatch update <server>     # review a capability diff, approve, activate
scopewatch diff <server>       # re-show the last computed diff
scopewatch status              # see everything installed and its state
scopewatch drift --all-clients # check for hand-edits to Scopewatch-owned config
```

See [docs/quickstart.md](docs/quickstart.md) for a full walkthrough.

## Documentation

- [docs/quickstart.md](docs/quickstart.md) — full walkthrough
- [docs/security-model.md](docs/security-model.md) — secrets, keychain,
  redaction, process isolation
- [docs/supported-matrix.md](docs/supported-matrix.md) — supported clients,
  install adapters, and known scope limits
- [docs/capability-inference-limits.md](docs/capability-inference-limits.md) —
  how capability inference works and where it can be wrong

## Development

This is a TypeScript/Node.js monorepo (npm workspaces). See
[CLAUDE.md](CLAUDE.md) for the full build log: locked design decisions,
phase-by-phase implementation notes, and every bug found during
verification.

```bash
npm install
npm run build
npm test
```

## License

MIT
