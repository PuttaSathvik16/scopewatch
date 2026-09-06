# Security Model

## Secrets: OS keychain only, never plaintext

Every secret a server requires is stored via native OS credential APIs —
`security` on macOS, `secret-tool`/Secret Service on Linux, Windows
Credential Manager (via `CredWrite`/`CredRead`/`CredDelete`) on Windows —
never a custom-crypto file store. This was a deliberate choice over a
native Node addon (`keytar`, `@napi-rs/keyring`): shelling out to each OS's
own tooling avoids native-binary ABI risk entirely while still being "native
credential APIs only."

**No fallback for missing keychain backends.** On headless Linux with no
Secret Service daemon running, Scopewatch refuses to store secrets rather
than falling back to an encrypted file — any such fallback needs its own
encryption key stored *somewhere*, which recreates the exact "no plaintext
anywhere" problem it claims to solve. Scopewatch is simply not usable for
secret-requiring servers on such a machine until a keychain backend is
provisioned.

**Secret values are never written to argv.** On macOS, `security
add-generic-password -w <value>` puts the value in the subprocess's command
line, visible to any process with `ps`/Activity Monitor access — verified
directly against this machine's own `security -h` output and a disposable
test keychain, not assumed. Scopewatch uses `-w` with no trailing value,
which makes `security` read the password from stdin instead. The same
principle applies on Linux (`secret-tool store` reads from stdin) and
Windows (the PowerShell script reads via `[Console]::In.ReadToEnd()`,
never interpolated into the `-Command` string).

**Secure prompt.** Terminal input for secrets uses `readline` with output
muted during entry (no echo) and requires a real TTY on stdin — a
piped/redirected input is refused rather than silently read some other way,
which could bypass the "never printed/logged" guarantee.

## Redaction: content-based, applied everywhere secret values could surface

Registered secret values are redacted from all log output by exact string
match, wherever they appear — not just in an expected field, but embedded
anywhere in a log line, including a failing server's own raw stderr output
during a connection test (`scopewatch test`). This was proven with a real
fixture: a server that writes something resembling a secret to stderr on
failure has that value redacted in the diagnostic message shown to the
user, verified by mutation-testing the redaction call itself (temporarily
skipping it and confirming the leak reproduces) before confirming the fix.

## Unreviewed servers get a minimal environment, not the full shell

A server that hasn't been activated yet — during `install`'s handshake,
`test`, or `update`'s pre-diff handshake — never receives the CLI's full
ambient environment. It gets `PATH` plus genuine platform-baseline
variables (`HOME`/`TMPDIR` on POSIX; `USERPROFILE`/`SystemRoot`/etc. on
Windows), plus only the specific secrets its own manifest declares. This
was a real regression caught in review: an earlier fix for a `PATH`
resolution bug initially threaded the CLI's entire `process.env` through,
which would have let an unreviewed, potentially buggy or malicious server
read every unrelated credential in the user's shell during its very first
run — turning a routine connection test into an exfiltration opportunity.

## Config files: ownership-tracked, never blindly overwritten

Scopewatch tracks exactly which config file key it wrote for each activated
server, and the exact value written. Every subsequent write touches only
that key — never another server's entry, never an unrelated top-level
setting in the same file, regardless of who added it. Restoration during
drift reconciliation reuses this same write path, not a second
implementation with its own chance to diverge.

## The capability diff is the trust boundary — see its limits

Every update shows a plain-language capability diff before the new version
activates — this is Scopewatch's core promise. But the diff is only as
good as the capability data behind it, and for auto-discovered servers,
that data is inferred, not verified. See
`docs/capability-inference-limits.md` for exactly what that inference can
and cannot promise — this is deliberately kept separate and prominent
rather than buried as a caveat, because overclaiming precision here would
undermine the entire security model above it.
