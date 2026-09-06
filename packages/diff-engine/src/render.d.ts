import type { CapabilityDiff } from './types.js';
/**
 * Render a capability diff to human-readable plain text.
 * Critical: output must be a one-sentence summary a human can understand without the manifests.
 *
 * Rendering order: severity descending (Tier 1 first), then grouped by tool.
 */
export declare function renderDiff(diff: CapabilityDiff): string;
/**
 * Extract a one-sentence summary from the diff for testing.
 * This is what the test assertions will check against.
 */
export declare function extractSummary(diff: CapabilityDiff): string;
//# sourceMappingURL=render.d.ts.map