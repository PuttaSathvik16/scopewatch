export type RegistryErrorCategory = 'network_unreachable' | 'server_not_found' | 'registry_error';

export class RegistryError extends Error {
  category: RegistryErrorCategory;
  detail: string | undefined;

  constructor(category: RegistryErrorCategory, message: string, detail?: string) {
    super(message);
    this.name = 'RegistryError';
    this.category = category;
    this.detail = detail;
  }
}

export function networkUnreachableError(detail: string): RegistryError {
  return new RegistryError(
    'network_unreachable',
    `Could not reach the MCP registry (network error). Check your internet connection, then retry.`,
    detail
  );
}

export function serverNotFoundError(name: string): RegistryError {
  return new RegistryError('server_not_found', `Server '${name}' was not found in the MCP registry.`);
}

export function registryErrorResponse(status: number, detail: string): RegistryError {
  return new RegistryError(
    'registry_error',
    `The MCP registry returned an unexpected error (HTTP ${status}). This may be a temporary registry issue; retry shortly.`,
    detail
  );
}
