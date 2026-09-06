/**
 * Redaction-first structured logger. No logging module existed anywhere in the
 * codebase before this - built fresh with redaction as a first-class feature,
 * not retrofitted onto an existing logger.
 *
 * Redaction works by content, not by key name: any string that is currently
 * registered as a "live secret value" gets replaced with [REDACTED] wherever it
 * appears in a log line, including inside unrelated text (e.g. an error message
 * that happens to embed the value) - not just when logged under an obviously
 * secret-sounding field name.
 *
 * A short substring of unrelated log text can occasionally be over-redacted if
 * it happens to match a live secret value. That's the safe failure direction
 * (over-redaction, not under-redaction) and is accepted as-is.
 */

const liveSecrets = new Set<string>();

/** Register a value for redaction in all subsequent log output. Idempotent. */
export function registerLiveSecret(value: string): void {
  if (value.length > 0) liveSecrets.add(value);
}

/** Stop redacting a value (e.g. once a process using it has exited). */
export function unregisterLiveSecret(value: string): void {
  liveSecrets.delete(value);
}

/** Exposed for tests only - never call in production code paths. */
export function _clearAllLiveSecretsForTesting(): void {
  liveSecrets.clear();
}

export function redact(text: string): string {
  let result = text;
  for (const secret of liveSecrets) {
    if (secret.length === 0) continue;
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

export type LogLevel = 'info' | 'warn' | 'error';

export type LogSink = (level: LogLevel, line: string) => void;

export type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

const defaultSink: LogSink = (level, line) => {
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
};

/** Create a logger. Pass a custom sink for testing (capture output without touching real stdout/stderr). */
export function createLogger(sink: LogSink = defaultSink): Logger {
  const write = (level: LogLevel, args: unknown[]) => {
    const rendered = args
      .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
      .join(' ');
    sink(level, redact(rendered));
  };

  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
