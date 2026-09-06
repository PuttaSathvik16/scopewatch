export type DriftErrorCategory = 'malformed_config_structure';

export class DriftError extends Error {
  category: DriftErrorCategory;
  detail: string | undefined;

  constructor(category: DriftErrorCategory, message: string, detail?: string) {
    super(message);
    this.name = 'DriftError';
    this.category = category;
    this.detail = detail;
  }
}

export function malformedConfigStructureError(configPath: string, detail: string): DriftError {
  return new DriftError(
    'malformed_config_structure',
    `The config file at '${configPath}' is not structured the way Scopewatch expects (${detail}). ` +
      `Cannot safely check for drift. This usually means something other than Scopewatch rewrote the ` +
      `file's overall shape, not just individual entries - inspect it manually before proceeding.`,
    detail
  );
}
