import type { ValidationError } from './schema.js';
/**
 * Format validation errors as readable, actionable messages.
 * Each error includes context, the problem, and a recovery suggestion.
 */
export declare function formatValidationErrors(errors: ValidationError[]): string;
/**
 * Render a validation error suitable for the CLI.
 */
export declare function renderValidationError(errors: ValidationError[]): string;
//# sourceMappingURL=errors.d.ts.map