import { test } from 'node:test';
import { strictEqual, ok, rejects } from 'node:assert';
import { Readable, Writable } from 'node:stream';
import { promptSecret } from '../src/prompt.js';

function fakeInput(lines: string[]): Readable & { isTTY: boolean } {
  const stream = new Readable({
    read() {},
  }) as Readable & { isTTY: boolean };
  stream.isTTY = true;
  process.nextTick(() => {
    for (const line of lines) stream.push(line + '\n');
  });
  return stream;
}

function capturingOutput(): { stream: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, chunks };
}

test('promptSecret: resolves with the typed value', async () => {
  const input = fakeInput(['my-typed-secret']);
  const { stream: output } = capturingOutput();

  const value = await promptSecret('Enter secret: ', { input, output });
  strictEqual(value, 'my-typed-secret');
});

test('promptSecret: the typed value is never written to the output stream (no echo)', async () => {
  const input = fakeInput(['do-not-echo-this-value']);
  const { stream: output, chunks } = capturingOutput();

  await promptSecret('Enter secret: ', { input, output });

  const allOutput = chunks.join('');
  ok(!allOutput.includes('do-not-echo-this-value'), `Typed value leaked into output stream: "${allOutput}"`);
});

test('promptSecret: the prompt message itself IS written to output', async () => {
  const input = fakeInput(['whatever']);
  const { stream: output, chunks } = capturingOutput();

  await promptSecret('Enter your secret token: ', { input, output });

  const allOutput = chunks.join('');
  ok(allOutput.includes('Enter your secret token:'), `Prompt message should still be shown. Got: "${allOutput}"`);
});

test('promptSecret: empty input is rejected as cancelled, not resolved with empty string', async () => {
  const input = fakeInput(['']);
  const { stream: output } = capturingOutput();

  await rejects(
    () => promptSecret('Enter secret: ', { input, output }),
    /cancelled/i
  );
});
