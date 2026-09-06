export { mergeConfig, readConfigFile, writeConfigFile } from './config-writer.js';
export type { ServerConfigEntry } from './config-writer.js';
export { CLAUDE_CODE_CLIENT_ID, claudeCodeConfigPath } from './claude-code-adapter.js';
export { CURSOR_CLIENT_ID, cursorConfigPath } from './cursor-adapter.js';
export { activateForClient, deactivateForClient, configPathFor } from './activate.js';
export { runWrapper } from './run-wrapper.js';
export type { RunWrapperDeps, SpawnFn } from './run-wrapper.js';
