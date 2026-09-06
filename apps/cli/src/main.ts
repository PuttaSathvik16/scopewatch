#!/usr/bin/env node
import { Command } from 'commander';
import { openDatabase, defaultDbPath } from '@scopewatch/state';
import { CLAUDE_CODE_CLIENT_ID } from '@scopewatch/client-adapters';
import * as cmds from './commands.js';
import { runCommand, formatError } from './cli-error-wrapper.js';

const program = new Command();
program.name('scopewatch').description('Local-first trust layer for MCP servers');

function getDb() {
  return openDatabase(defaultDbPath());
}

program
  .command('doctor')
  .description('Check prerequisites (Node/npm)')
  .action(async () => {
    const result = cmds.cmdDoctor({ db: getDb() });
    if (result.ok) {
      console.log(`Node ${result.nodeVersion}, npm ${result.npmVersion} - OK`);
    } else {
      console.error(formatError(result.error));
      process.exitCode = 1;
    }
  });

program
  .command('search <term>')
  .description('Search the MCP registry')
  .action(async (term: string) => {
    const result = await runCommand(() => cmds.cmdSearch(term, { db: getDb() }));
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
    } else if (!result.value.ok) {
      console.error(formatError(result.value.error));
      process.exitCode = 1;
    } else {
      for (const s of result.value.result.servers) console.log(`${s.name} - ${s.description}`);
    }
  });

program
  .command('info <server>')
  .description('Show details for a server')
  .action(async (server: string) => {
    const result = await runCommand(() => cmds.cmdInfo(server, { db: getDb() }));
    if (!result.ok) {
      console.error(result.message);
      process.exitCode = 1;
    } else if (!result.value.ok) {
      console.error(formatError(result.value.error));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result.value.server, null, 2));
    }
  });

program
  .command('install <server>')
  .option('--client <client>', 'client to install for', CLAUDE_CODE_CLIENT_ID)
  .description('Install a server')
  .action(async (server: string, opts: { client: string }) => {
    const result = await runCommand(() => cmds.cmdInstall(server, opts.client, { db: getDb() }));
    if (result.ok && result.value.ok) {
      console.log(`Installed ${server}. ${result.value.warnings.length} inference warnings.`);
    } else {
      console.error(result.ok ? formatError((result.value as any).error) : result.message);
      process.exitCode = 1;
    }
  });

program
  .command('test <server>')
  .option('--client <client>', 'client', CLAUDE_CODE_CLIENT_ID)
  .description('Test connection to an installed server')
  .action(async (server: string, opts: { client: string }) => {
    const result = await runCommand(() => cmds.cmdTest(server, opts.client, { db: getDb() }));
    if (result.ok && result.value.ok) {
      console.log(`OK - ${result.value.tools.length} tools`);
    } else {
      console.error(result.ok ? formatError((result.value as any).error) : result.message);
      process.exitCode = 1;
    }
  });

program
  .command('activate <server>')
  .option('--client <client>', 'client', CLAUDE_CODE_CLIENT_ID)
  .description('Activate a server for a client')
  .action(async (server: string, opts: { client: string }) => {
    const result = await runCommand(() => cmds.cmdActivate(server, opts.client, { db: getDb() }));
    console.log(result.ok ? 'Activated' : result.message);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command('status')
  .description('Show status of all installed servers')
  .action(() => {
    const rows = cmds.cmdStatus({ db: getDb() });
    console.table(rows);
  });

program
  .command('rollback <server>')
  .option('--client <client>', 'client', CLAUDE_CODE_CLIENT_ID)
  .description('Roll back to the last known-good version')
  .action(async (server: string, opts: { client: string }) => {
    const result = await runCommand(() => cmds.cmdRollback(server, opts.client, { db: getDb() }));
    console.log(result.ok ? 'Rolled back' : result.message);
    if (!result.ok) process.exitCode = 1;
  });

program
  .command('drift')
  .option('--all-clients')
  .description('(stub) client config drift detection - Phase H')
  .action(() => {
    console.log(cmds.cmdDrift().message);
  });

program
  .command('init')
  .description('Initialize local Scopewatch state')
  .action(() => {
    getDb();
    console.log(`Initialized state database at ${defaultDbPath()}`);
  });

program.parseAsync(process.argv);
