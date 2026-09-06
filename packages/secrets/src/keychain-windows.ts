import { spawnSync } from 'node:child_process';
import { KEYCHAIN_SERVICE_NAME } from './secret-ref.js';
import { itemNotFoundError, unrecognizedSecretError, SecretError } from './errors.js';

/**
 * IMPORTANT - unverified on real Windows: this repo's development environment
 * is macOS (Darwin). This implementation is written strictly per the documented
 * Win32 Credential Manager API contracts (CredWrite/CredRead/CredDelete in
 * Advapi32.dll) and the standard PowerShell `Add-Type` P/Invoke pattern, but it
 * has not been executed on a real Windows machine. It must be validated there
 * before being relied on in production.
 */

export type SpawnFn = (
  command: string,
  args: string[],
  options: { input?: string }
) => { status: number | null; stdout: string; stderr: string };

const defaultSpawn: SpawnFn = (command, args, options) => {
  const result = spawnSync(command, args, { input: options.input, encoding: 'utf-8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/**
 * The P/Invoke glue, shared by store/retrieve/delete. Defined once via
 * Add-Type so each invocation of powershell.exe only pays the compile cost once
 * per process. TargetName is passed as a normal -TargetName argument (not
 * sensitive - it's the "server_id:secret_id" reference, never the value).
 *
 * CRITICAL: the secret VALUE must never be interpolated into the -Command
 * string or any argv element - that would expose it via Task Manager's
 * "Command line" column / `Get-Process | Select CommandLine`, identically to
 * the macOS argv exposure this design avoided. The store script instead reads
 * the value from stdin via [Console]::In.ReadToEnd(), exactly as the macOS
 * `security -w` (no value) and Linux `secret-tool store` paths do.
 */
const CRED_MANAGER_TYPE = `
Add-Type -Namespace ScopewatchCred -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
}

[DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredWrite(ref CREDENTIAL userCredential, uint flags);

[DllImport("Advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

[DllImport("Advapi32.dll", SetLastError = true)]
public static extern bool CredDelete(string target, int type, int flags);

[DllImport("Advapi32.dll", SetLastError = true)]
public static extern bool CredFree(IntPtr credentialPtr);
'@
`;

const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;

function storeScript(ref: string): string {
  return `
${CRED_MANAGER_TYPE}
$secretValue = [Console]::In.ReadToEnd()
$secretValue = $secretValue.TrimEnd("\`r", "\`n")
$blobBytes = [System.Text.Encoding]::Unicode.GetBytes($secretValue)
$blobPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($blobBytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($blobBytes, 0, $blobPtr, $blobBytes.Length)
try {
  $cred = New-Object ScopewatchCred.Native+CREDENTIAL
  $cred.Type = ${CRED_TYPE_GENERIC}
  $cred.TargetName = "${escapePs(ref)}"
  $cred.CredentialBlobSize = $blobBytes.Length
  $cred.CredentialBlob = $blobPtr
  $cred.Persist = ${CRED_PERSIST_LOCAL_MACHINE}
  $cred.UserName = "scopewatch"
  $ok = [ScopewatchCred.Native]::CredWrite([ref]$cred, 0)
  if (-not $ok) { exit 1 }
} finally {
  [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blobPtr)
}
exit 0
`;
}

function retrieveScript(ref: string): string {
  return `
${CRED_MANAGER_TYPE}
$credPtr = [IntPtr]::Zero
$ok = [ScopewatchCred.Native]::CredRead("${escapePs(ref)}", ${CRED_TYPE_GENERIC}, 0, [ref]$credPtr)
if (-not $ok) { exit 2 }
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][ScopewatchCred.Native+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  $value = [System.Text.Encoding]::Unicode.GetString($bytes)
  [Console]::Out.Write($value)
} finally {
  [ScopewatchCred.Native]::CredFree($credPtr) | Out-Null
}
exit 0
`;
}

function deleteScript(ref: string): string {
  return `
${CRED_MANAGER_TYPE}
$ok = [ScopewatchCred.Native]::CredDelete("${escapePs(ref)}", ${CRED_TYPE_GENERIC}, 0)
if (-not $ok) { exit 2 }
exit 0
`;
}

function escapePs(s: string): string {
  return s.replace(/"/g, '`"');
}

export function windowsStore(ref: string, value: string, spawn: SpawnFn = defaultSpawn): SecretError | null {
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', storeScript(ref)], {
    input: `${value}\n`,
  });

  if (result.status === 0) return null;
  return unrecognizedSecretError(result.stderr);
}

export function windowsRetrieve(ref: string, spawn: SpawnFn = defaultSpawn): { value: string } | { error: SecretError } {
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', retrieveScript(ref)], {});

  if (result.status === 0) return { value: result.stdout };
  if (result.status === 2) return { error: itemNotFoundError(ref) };
  return { error: unrecognizedSecretError(result.stderr) };
}

export function windowsDelete(ref: string, spawn: SpawnFn = defaultSpawn): SecretError | null {
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', deleteScript(ref)], {});

  if (result.status === 0) return null;
  if (result.status === 2) return itemNotFoundError(ref);
  return unrecognizedSecretError(result.stderr);
}
