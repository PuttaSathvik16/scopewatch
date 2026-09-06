/**
 * Shared CLI error-UX wrapper: any error with a .category/.message shape
 * (InstallError, SecretError, RegistryError, McpTestError) is surfaced
 * as-is - already actionable, never flattened into a generic message.
 * Anything unrecognized gets a generic "this may be a bug" message, with
 * the full stack only under --verbose.
 */
export function formatError(err: unknown, verbose = false): string {
  if (err && typeof err === 'object' && 'category' in err && 'message' in err) {
    return String((err as any).message);
  }
  if (err instanceof Error) {
    if (verbose) return err.stack ?? err.message;
    return `Unexpected error: ${err.message} (run with --verbose for a stack trace; this may be a bug - please report it)`;
  }
  return `Unexpected error: ${String(err)}`;
}

export async function runCommand<T>(fn: () => Promise<T> | T, verbose = false): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: formatError(err, verbose) };
  }
}
