# Supported Clients, Scope, and Config-Ownership Guarantees

## Supported clients (v1)

Scopewatch supports three agent clients: **Claude Code**, **Cursor**, and
**VS Code Copilot** (agent mode). Supporting "every client" was explicitly
cut to keep the capability-diff promise correct and well-tested for a
small, real set of targets rather than thinly correct for many — this list
grows deliberately, one verified client at a time, not by default.

Note VS Code's real config format uses a different top-level key
(`"servers"`) than Claude Code and Cursor's shared `"mcpServers"` — verified
against VS Code's own documentation before implementing, not assumed from
the other two clients' shape.

## Project scope only

Scopewatch **only activates servers at project scope**:

- Claude Code: writes to `.mcp.json` at your project's root.
- Cursor: writes to `.cursor/mcp.json` at your project's root.
- VS Code: writes to `.vscode/mcp.json` at your project's root.

Scopewatch **never writes to any client's global/user-scope config**
(`~/.claude.json` for Claude Code, `~/.cursor/mcp.json` for Cursor, VS
Code's user-profile `mcp.json`). This is a deliberate v1 limitation:

- Claude Code's `~/.claude.json` is a single file spanning every project on
  your machine, mixed with unrelated, non-MCP settings — a much higher-risk
  target for "never silently overwrite user config" than a small,
  MCP-dedicated project file.
- Restricting to project scope keeps the ownership-tracking guarantee below
  simple and matches the primary use case: a team sharing a
  Scopewatch-managed manifest via a cloned repository.

**What this means in practice:** if you want a server available in every
project you open, you currently have to activate it separately in each
project. There is no "activate globally, once" path in v1.

## What the ownership-tracked config writer guarantees

When Scopewatch activates a server, it records exactly which config file key
it created for that server, and the exact value it wrote. On every
subsequent write (an update, a deactivation), it touches **only** the keys
it owns — any other entry in the same `mcpServers` object, or any other
top-level key in the file, is left completely untouched, whether it was
added by you, by hand, or by another tool.

## Drift detection and reconciliation (built)

Scopewatch detects when a config entry it owns has drifted from what it
last wrote — whether the entry's value changed, or the entry was removed
entirely:

- `scopewatch drift --all-clients` reports every drifted entry, read-only —
  it never writes anything on its own.
- `scopewatch drift --resolve` walks through each drifted entry and lets
  you choose: keep your edit (Scopewatch stops flagging it), restore
  Scopewatch's last-known version, or skip for now.

If a config entry predates this tracking (from before drift detection
existed), Scopewatch has no real historical value to compare against or
restore from. It reports this honestly as **`unverifiable`**, not as
`changed` — and the only available resolution is adopting your current
config as the new baseline going forward. Scopewatch will never offer to
"restore" a fabricated value over your real, working configuration.

## Baseline connection testing (`scopewatch test`)

`scopewatch test <server>` performs a real MCP handshake (`initialize` →
`tools/list`) against the installed server and reports one of:
`spawn_failed`, `handshake_timeout`, `malformed_response`,
`initialize_rejected`, `tools_list_failed`. This answers "does this server
speak MCP correctly right now" — it does not retry on failure (a flaky
server's timeout is itself useful diagnostic information, not something to
paper over) and does not attempt deeper protocol conformance testing beyond
the initial handshake and tool enumeration.
