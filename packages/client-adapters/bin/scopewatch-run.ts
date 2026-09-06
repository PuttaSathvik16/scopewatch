#!/usr/bin/env node
import { openDatabase, defaultDbPath } from '@scopewatch/state';
import { runWrapper } from '../src/run-wrapper.js';

async function main() {
  const [server_id, client_id] = process.argv.slice(2);
  if (!server_id || !client_id) {
    process.stderr.write('scopewatch-run: usage: scopewatch-run <server_id> <client_id>\n');
    process.exit(1);
  }

  const db = openDatabase(defaultDbPath());
  const exitCode = await runWrapper(server_id, client_id, { db });
  db.close();
  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`scopewatch-run: unexpected error: ${err?.message ?? err}\n`);
  process.exit(1);
});
