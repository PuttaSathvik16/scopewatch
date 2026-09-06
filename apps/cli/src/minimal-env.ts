/**
 * Builds a deliberately minimal environment for spawning an unreviewed or
 * not-yet-activated MCP server process (the handshake/test spawn), following
 * the same philosophy as the scopewatch-run wrapper (Phase F): only PATH
 * (needed for npx/node resolution) plus the platform-baseline variables
 * Node/npm genuinely need to run at all, and - when available - only the
 * SPECIFIC secrets this server's own manifest declares, via the controlled
 * keychain path. Never the CLI process's full ambient environment.
 *
 * Why this matters specifically here: this spawn runs during `install`/
 * `test`/`update` - BEFORE the user has seen a capability diff or approved
 * anything. A server at this stage has not been reviewed. Handing it the
 * full process.env would let an unreviewed, potentially buggy or malicious
 * server read every unrelated credential sitting in the user's shell
 * environment during its very first run - turning the test/handshake step
 * itself into an exfiltration opportunity, which is exactly what this
 * product exists to prevent elsewhere.
 */
export function minimalSpawnEnv(secrets: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  if (process.env.PATH) env.PATH = process.env.PATH;

  if (process.platform === 'win32') {
    if (process.env.PATHEXT) env.PATHEXT = process.env.PATHEXT;
    if (process.env.USERPROFILE) env.USERPROFILE = process.env.USERPROFILE;
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot; // required by Node's own DNS/crypto internals on Windows
    if (process.env.TEMP) env.TEMP = process.env.TEMP;
    if (process.env.TMP) env.TMP = process.env.TMP;
    if (process.env.APPDATA) env.APPDATA = process.env.APPDATA;
  } else {
    if (process.env.HOME) env.HOME = process.env.HOME;
    if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  }

  return { ...env, ...secrets };
}
