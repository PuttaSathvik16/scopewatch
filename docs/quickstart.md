# Quickstart

This walks through Journey A from the product brief — the same sequence
proven end-to-end by `apps/cli/test/journey-a.test.ts` against a real MCP
handshake and a real diff computation, not just a documented aspiration.

## 1. Check prerequisites

```
scopewatch doctor
```

Confirms Node.js ≥ 22.0.0 and npm are present. Node 24.x is recommended but
not required.

## 2. Search for a server

```
scopewatch search <term>
```

Queries the official MCP registry (`registry.modelcontextprotocol.io`) by
substring match on server name.

## 3. Look at what it does before installing

```
scopewatch info <server-name>
```

Shows the registry's full listing: description, version, declared
environment variables, and repository link.

## 4. Install

```
scopewatch install <server-name> --client claude-code
```

This does real work, in order:
1. Fetches the server's package info from the registry.
2. Installs the npm package.
3. Runs a real MCP handshake against the freshly-installed server to get its
   actual tool list.
4. Infers each tool's capability (read/write/send/fetch/delete/execute) from
   its name, description, and any MCP annotations it declares — see
   `docs/capability-inference-limits.md` for exactly what this can and can't
   promise.
5. Prompts you for each required secret and stores it in your OS keychain —
   never in a config file, never in plaintext, never in a log.
6. Stops at the `validated` lifecycle state. It does **not** activate the
   server yet.

## 5. Test the connection

```
scopewatch test <server-name>
```

Performs a real MCP handshake and reports whether the server responds
correctly, with a categorized, actionable message if it doesn't.

## 6. Activate

```
scopewatch activate <server-name> --client claude-code
```

Writes the server into your client's config file (`.mcp.json` for Claude
Code, `.cursor/mcp.json` for Cursor), pointing at the `scopewatch-run`
wrapper — never the raw server binary — so your keychain-stored secrets
reach the process without ever touching the config file itself.

## 7. Weeks later: check for updates

```
scopewatch update --check <server-name>
```

## 8. See what changed, and decide

```
scopewatch update <server-name>
```

Computes and shows a real capability diff between your currently-active
version and the new one — plain language, severity-ordered, before
anything is activated. If the new version introduces something genuinely
destructive (a tool gaining delete/write/execute access it didn't have
before), this is flagged as high risk immediately, not buried in a wall of
text.

```
scopewatch diff <server-name>
```

Re-shows the last computed diff at any time.

Approving moves the update to `active`. Declining leaves it at `updated`
— **the server is never silently activated without you seeing this
diff first.**

## If something goes wrong

```
scopewatch rollback <server-name>
```

Restores the last known-good version.

```
scopewatch status
```

Shows the current lifecycle state of every server you've installed.

```
scopewatch drift --all-clients
scopewatch drift --resolve
```

Detects and (interactively) reconciles config file entries Scopewatch owns
that have drifted from what it last wrote — see
`docs/supported-matrix.md` for the detection/resolution model.
