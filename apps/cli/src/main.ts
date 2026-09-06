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
  .command('deactivate <server>')
  .option('--client <client>', 'client', CLAUDE_CODE_CLIENT_ID)
  .description('Remove a server from a client\'s config (never touches unrelated entries)')
  .action(async (server: string, opts: { client: string }) => {
    const result = await runCommand(() => cmds.cmdDeactivate(server, opts.client, { db: getDb() }));
    console.log(result.ok ? 'Deactivated' : result.message);
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
  .command('diff <server>')
  .option('--client <client>', 'client', CLAUDE_CODE_CLIENT_ID)
  .description('Re-show the last computed capability diff for a server')
  .action((server: string, opts: { client: string }) => {
    const result = cmds.cmdDiff(server, opts.client, { db: getDb() });
    if (result.ok) {
      console.log(result.rendered);
    } else {
      console.error(formatError(result.error));
      process.exitCode = 1;
    }
  });

program
  .command('update [server]')
  .option('--check', 'only check whether a newer version is available; do not compute or apply anything')
  .option('--client <client>', 'client', CLAUDE_CODE_CLIENT_ID)
  .description('Check for updates, or compute and show a diff for approval before activating')
  .action(async (server: string | undefined, opts: { check?: boolean; client: string }) => {
    const db = getDb();

    if (!server) {
      console.error('Usage: scopewatch update <server> [--check]');
      process.exitCode = 1;
      return;
    }

    if (opts.check) {
      const result = await runCommand(() => cmds.cmdUpdateCheck(server, opts.client, { db }));
      if (!result.ok) {
        console.error(result.message);
        process.exitCode = 1;
      } else if (!result.value.ok) {
        console.error(formatError(result.value.error));
        process.exitCode = 1;
      } else if (result.value.hasUpdate) {
        console.log(`Update available: ${result.value.currentVersion} -> ${result.value.latestVersion}. Run 'scopewatch update ${server}' to review.`);
      } else {
        console.log(`Already on the latest version (${result.value.currentVersion}).`);
      }
      return;
    }

    // Full update: compute the real diff, show it, and require explicit approval
    // BEFORE activation - never auto-activate, per the brief's core UX rule.
    const updateResult = await runCommand(() => cmds.cmdUpdate(server, opts.client, { db }));
    if (!updateResult.ok) {
      console.error(updateResult.message);
      process.exitCode = 1;
      return;
    }
    if (!updateResult.value.ok) {
      console.error(formatError((updateResult.value as any).error));
      process.exitCode = 1;
      return;
    }

    console.log(updateResult.value.rendered);

    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Approve this update and activate it now? [y/N]: ');
    rl.close();

    if (answer.trim().toLowerCase() === 'y') {
      cmds.cmdApproveUpdate(server, opts.client, updateResult.value.newManifestId, { db });
      console.log('Approved and activated.');
    } else {
      console.log(
        `Update held. The server remains on its previous version until you approve it - run 'scopewatch update ${server}' again to reconsider, or 'scopewatch rollback ${server}' to abandon it.`
      );
    }
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

function statusLabel(status: string): string {
  return status === 'unverifiable' ? 'unverifiable (no historical snapshot - safe to adopt, cannot restore)' : status;
}

program
  .command('drift')
  .option('--all-clients')
  .option('--resolve', 'interactively resolve each drifted entry (keep/restore/skip)')
  .description('Detect (and optionally resolve) client config drift')
  .action(async (opts: { resolve?: boolean }) => {
    const db = getDb();

    if (!opts.resolve) {
      const results = cmds.cmdDrift({ db });
      for (const { server_id, client_id, result } of results) {
        if (!result.ok) {
          console.log(`${server_id} (${client_id}): ${formatError(result.error)}`);
        } else {
          console.log(`${server_id} (${client_id}) [${result.entry.config_key}]: ${statusLabel(result.entry.status)}`);
        }
      }
      return;
    }

    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const result = await cmds.cmdDriftResolve({
      db,
      promptChoice: async (entry) => {
        const valid = (await import('@scopewatch/client-adapters')).validResolutionsFor(entry.status);
        const answer = await rl.question(
          `${entry.server_id} (${entry.client_id}) [${entry.config_key}] is ${statusLabel(entry.status)}. ` +
            `Choose (${valid.join('/')}): `
        );
        return (valid.includes(answer.trim() as any) ? answer.trim() : 'skip') as any;
      },
    });
    rl.close();

    if (result.ok) {
      console.log(`Resolved ${result.resolved}, skipped ${result.skipped}.`);
    } else {
      console.error(formatError(result.error));
      process.exitCode = 1;
    }
  });

program
  .command('init')
  .description('Initialize local Scopewatch state')
  .action(() => {
    getDb();
    console.log(`Initialized state database at ${defaultDbPath()}`);
  });

program.parseAsync(process.argv);
