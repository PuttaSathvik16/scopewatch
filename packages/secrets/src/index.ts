export { secretRef, KEYCHAIN_SERVICE_NAME } from './secret-ref.js';
export { storeSecret, retrieveSecret, deleteSecret, injectSecrets } from './keychain.js';
export type { KeychainResult, RetrieveResult } from './keychain.js';
export { promptSecret } from './prompt.js';
export type { PromptStreams } from './prompt.js';
export {
  createLogger,
  redact,
  registerLiveSecret,
  unregisterLiveSecret,
  _clearAllLiveSecretsForTesting,
} from './logger.js';
export type { Logger, LogLevel, LogSink } from './logger.js';
export {
  SecretError,
  noKeychainBackendError,
  itemNotFoundError,
  notATtyError,
  promptCancelledError,
  unrecognizedSecretError,
} from './errors.js';
export type { SecretErrorCategory } from './errors.js';
