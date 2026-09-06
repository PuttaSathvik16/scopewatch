export { checkPrerequisites, satisfiesMinVersion } from './prerequisites.js';
export type { PrerequisiteCheckResult, CommandRunner } from './prerequisites.js';
export { installPackage, categorizeNpmFailure, checkEntryPoint } from './npm-adapter.js';
export type { InstallResult, InstallRunner } from './npm-adapter.js';
export {
  InstallError,
  MIN_NODE_VERSION,
  RECOMMENDED_NODE_VERSION,
  nodeNotInstalledError,
  nodeVersionTooOldError,
  npmNotInstalledError,
  packageNotFoundError,
  networkUnreachableError,
  permissionDeniedError,
  entryPointBrokenError,
  unrecognizedInstallError,
} from './errors.js';
export type { InstallErrorCategory } from './errors.js';
