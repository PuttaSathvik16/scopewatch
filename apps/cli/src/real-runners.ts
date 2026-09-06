import { execFileSync } from 'node:child_process';
import type { InstallRunner } from '@scopewatch/install-adapters';
import type { CommandRunner } from '@scopewatch/install-adapters';

export const realInstallRunner: InstallRunner = (command, args) => {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf-8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? String(err.message ?? err),
    };
  }
};

export const realCommandRunner: CommandRunner = (command, args) => execFileSync(command, args, { encoding: 'utf-8' });
