/**
 * Format validation errors as readable, actionable messages.
 * Each error includes context, the problem, and a recovery suggestion.
 */
export function formatValidationErrors(errors) {
    const lines = [];
    for (const error of errors) {
        const path = formatPath(error.path);
        const context = path ? `at ${path}` : 'at root';
        lines.push('');
        lines.push(`❌ Manifest validation failed ${context}:`);
        lines.push('');
        lines.push(`  ${error.message}`);
        // Provide context-specific recovery suggestions
        const suggestion = getRecoverySuggestion(error);
        if (suggestion) {
            lines.push('');
            lines.push(suggestion);
        }
    }
    if (lines.length === 0) {
        return 'Manifest is valid.';
    }
    return lines.join('\n');
}
/**
 * Convert path array to dot-notation string.
 * E.g., ['capabilities', 0, 'tool_id'] → 'capabilities[0].tool_id'
 */
function formatPath(path) {
    if (path.length === 0)
        return '';
    return path.reduce((acc, segment, i) => {
        if (typeof segment === 'number') {
            return `${acc}[${segment}]`;
        }
        return i === 0 ? String(segment) : `${acc}.${segment}`;
    }, '');
}
/**
 * Provide contextual recovery suggestions based on error type.
 */
function getRecoverySuggestion(error) {
    const path = error.path.map(p => String(p)).join('.');
    const code = error.code;
    // Schema version mismatch
    if (path === 'schemaVersion' && code === 'invalid_literal') {
        return (`  Fix: This tool only supports schemaVersion: 1.\n` +
            `  If you have an older manifest, it must be migrated first.`);
    }
    // Version format
    if (path === 'version' && code === 'invalid_string') {
        return (`  Fix: version must be semantic versioning (e.g., "1.2.0")\n` +
            `  Current format is invalid.`);
    }
    // Missing required fields
    if (code === 'invalid_union' || error.message.includes('Required')) {
        const lastSegment = error.path[error.path.length - 1];
        const field = typeof lastSegment === 'string' ? lastSegment : null;
        if (field === 'tool_id') {
            return (`  Fix: Every capability must declare which tool provides it.\n` +
                `  Add "tool_id": "my_tool_id" to this capability entry.`);
        }
        if (field === 'verb') {
            return (`  Fix: Every capability must declare a verb: one of\n` +
                `    read | fetch | send | write | delete | execute`);
        }
    }
    // Array minimum length
    if (code === 'too_small') {
        if (path === 'tools') {
            return `  Fix: At least one tool must be declared.`;
        }
        if (path.includes('secrets') || path.includes('used_by')) {
            return `  Fix: This array must not be empty.`;
        }
    }
    // Invalid URL
    if (code === 'invalid_string' && error.message.includes('URL')) {
        return (`  Fix: homepage must be a valid URL (e.g., "https://example.com")\n` +
            `  Remove it if not applicable, or format it as a full URL.`);
    }
    return null;
}
/**
 * Render a validation error suitable for the CLI.
 */
export function renderValidationError(errors) {
    if (errors.length === 0) {
        return '✓ Manifest is valid.';
    }
    const header = errors.length === 1 ? 'Validation error:' : `${errors.length} validation errors:`;
    const formatted = formatValidationErrors(errors);
    return `${header}\n${formatted}`;
}
//# sourceMappingURL=errors.js.map