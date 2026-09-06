import { execFileSync } from 'node:child_process';
import type { InstallRunner } from '@scopewatch/install-adapters';
import type { CommandRunner } from '@scopewatch/install-adapters';

/**
 * Real bug, found via a real Windows CI run (not assumed): `npm` and `npx`
 * ship as `.cmd` files on Windows, and Node's child_process deliberately
 * does NOT auto-resolve bare commands to `.cmd`/`.bat` targets without
 * `shell: true` - only real executables (`.exe`/`.com`) get that automatic
 * PATH+extension resolution. Without this, `execFileSync('npm', [...])`
 * threw ENOENT on every real Windows machine, meaning `scopewatch doctor`
 * and `scopewatch install` never actually worked there - undetected until
 * now because no test had ever exercised these real (uninjected) runners
 * against a real npm/node install on any platform; every existing test
 * injects a fake runner, and the one real-npm e2e test only runs on Linux.
 * `shell: true` is safe here on a patched Node (this project's floor is
 * 22.0.0, well past the cmd.exe argument-escaping fix in CVE-2024-27980)
 * and is Node's own documented way to invoke `.cmd`/`.bat` targets.
 */
const WINDOWS_SHELL = process.platform === 'win32';

export const realInstallRunner: InstallRunner = (command, args) => {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf-8', shell: WINDOWS_SHELL });
    return { code: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      code: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? String(err.message ?? err),
    };
  }
};

export const realCommandRunner: CommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: 'utf-8', shell: WINDOWS_SHELL });
