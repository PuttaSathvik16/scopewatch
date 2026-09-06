# What Activation Does and Does Not Cover

This is a partial note started during Phase F (client adapters). The full
docs suite (quickstart, security model, supported client/server matrix) is
Phase I's scope - this file exists now specifically to state the following
limitation where a user will actually find it, rather than let it be
discovered by confusion later.

## Supported clients (v1)

Scopewatch supports exactly two agent clients: **Claude Code** and
**Cursor**.

## Project scope only

Scopewatch **only activates servers at project scope**:

- Claude Code: writes to `.mcp.json` at your project's root.
- Cursor: writes to `.cursor/mcp.json` at your project's root.

Scopewatch **never writes to either client's global/user-scope config**
(`~/.claude.json` for Claude Code, `~/.cursor/mcp.json` for Cursor). This is
a deliberate v1 limitation, not an oversight:

- Claude Code's `~/.claude.json` is a single file spanning every project on
  your machine, mixed with unrelated, non-MCP settings - a much higher-risk
  target for "never silently overwrite user config" than a small,
  MCP-dedicated project file.
- Restricting to project scope keeps the ownership-tracking guarantee (see
  below) simple and matches the primary use case: a team sharing a
  Scopewatch-managed manifest via a cloned repository.

**What this means in practice:** if you want a server available in every
project you open, you currently have to activate it separately in each
project. There is no "activate globally, once" path in v1.

## What the ownership-tracked config writer guarantees - and doesn't

When Scopewatch activates a server, it records exactly which config file key
it created for that server. On every subsequent write (an update, a
deactivation), it touches **only** the keys it has recorded ownership of -
any other entry in the same `mcpServers` object, or any other top-level key
in the file, is left completely untouched, whether it was added by you, by
hand, or by another tool.

**What this does not yet do:** it does not detect if you (or something else)
manually edit an entry Scopewatch itself created. If you hand-edit the
`args` of a Scopewatch-managed server entry, Scopewatch's ownership table
still considers that key "ours," and the next time Scopewatch writes to that
file (e.g. during an update), your manual edit will be silently overwritten
with no warning. Detecting and reconciling that kind of drift is the job of
the **client drift reconciler** (a later phase, not yet built) - until then,
avoid hand-editing a Scopewatch-managed entry if you want your edit to
survive the next update.
