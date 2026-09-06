import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import {
  createLogger,
  redact,
  registerLiveSecret,
  unregisterLiveSecret,
  _clearAllLiveSecretsForTesting,
} from '../src/logger.js';

test('redact: replaces a registered secret value wherever it appears', () => {
  _clearAllLiveSecretsForTesting();
  registerLiveSecret('super-secret-token-123');

  const result = redact('Connecting with token super-secret-token-123 to the API');
  strictEqual(result, 'Connecting with token [REDACTED] to the API');

  _clearAllLiveSecretsForTesting();
});

test('redact: replaces a secret value even embedded in unrelated text (content-based, not key-based)', () => {
  _clearAllLiveSecretsForTesting();
  registerLiveSecret('sk-abc123');

  const result = redact('HTTP 401: Authorization header "Bearer sk-abc123" was rejected by upstream');
  ok(result.includes('[REDACTED]'), `Expected redaction in unrelated error text. Got: "${result}"`);
  ok(!result.includes('sk-abc123'), 'raw secret value must not survive redaction');

  _clearAllLiveSecretsForTesting();
});

test('redact: unregistering a secret stops future redaction of that value', () => {
  _clearAllLiveSecretsForTesting();
  registerLiveSecret('temp-value-xyz');
  unregisterLiveSecret('temp-value-xyz');

  const result = redact('value is temp-value-xyz');
  strictEqual(result, 'value is temp-value-xyz');
});

test('createLogger: sink receives redacted output, never the raw secret', () => {
  _clearAllLiveSecretsForTesting();
  registerLiveSecret('ghp_realvaluehere');

  const lines: string[] = [];
  const logger = createLogger((_level, line) => lines.push(line));

  logger.info('Injecting GITHUB_TOKEN=ghp_realvaluehere into server env');

  strictEqual(lines.length, 1);
  ok(!lines[0]!.includes('ghp_realvaluehere'), `Raw secret leaked into log sink: "${lines[0]}"`);
  ok(lines[0]!.includes('[REDACTED]'), `Expected redaction marker. Got: "${lines[0]}"`);

  _clearAllLiveSecretsForTesting();
});

test('createLogger: error level also redacts', () => {
  _clearAllLiveSecretsForTesting();
  registerLiveSecret('leak-me-not');

  const lines: { level: string; line: string }[] = [];
  const logger = createLogger((level, line) => lines.push({ level, line }));

  logger.error('Failed to spawn process with env containing leak-me-not');

  strictEqual(lines[0]!.level, 'error');
  ok(!lines[0]!.line.includes('leak-me-not'));

  _clearAllLiveSecretsForTesting();
});

test('createLogger: non-string args are stringified before redaction is applied', () => {
  _clearAllLiveSecretsForTesting();
  registerLiveSecret('nested-secret-val');

  const lines: string[] = [];
  const logger = createLogger((_level, line) => lines.push(line));

  logger.info('context:', { token: 'nested-secret-val', ok: true });

  ok(!lines[0]!.includes('nested-secret-val'), `Raw secret leaked via object arg: "${lines[0]}"`);

  _clearAllLiveSecretsForTesting();
});
