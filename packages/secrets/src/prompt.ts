import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import { notATtyError, promptCancelledError } from './errors.js';

export type PromptStreams = {
  input: NodeJS.ReadableStream & { isTTY?: boolean };
  output: NodeJS.WritableStream;
};

/**
 * Securely prompt for a secret value: no terminal echo, and the value never
 * appears on the command line or in shell history (it's only ever read as
 * stdin during this interactive prompt).
 *
 * Requires a real TTY on stdin by default (checked via `isTTY`) - a non-TTY
 * context (piped/redirected input) is refused rather than silently read some
 * other way, since that would be an unaudited path that could bypass the
 * "never printed/logged" guarantee this function exists to provide. Tests
 * inject streams explicitly instead of relying on isTTY.
 */
export function promptSecret(message: string, streams?: PromptStreams): Promise<string> {
  const input = streams?.input ?? process.stdin;
  const output = streams?.output ?? process.stdout;

  if (!streams && !(process.stdin as any).isTTY) {
    return Promise.reject(notATtyError());
  }

  return new Promise((resolve, reject) => {
    // Mute the output stream's echo of typed characters while still allowing
    // the prompt message itself to be written.
    let muted = false;
    const mutableOutput = new Writable({
      write(chunk, _enc, callback) {
        if (!muted) output.write(chunk);
        callback();
      },
    });

    const rl = readline.createInterface({
      input,
      output: mutableOutput,
      terminal: true,
    });

    output.write(message);
    muted = true;

    rl.question('', (answer) => {
      muted = false;
      rl.close();
      output.write('\n');
      if (answer.length === 0) {
        reject(promptCancelledError());
      } else {
        resolve(answer);
      }
    });
  });
}
