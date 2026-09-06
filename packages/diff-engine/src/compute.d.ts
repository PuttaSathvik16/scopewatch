import type { ServerManifest } from '@scopewatch/manifest';
import type { CapabilityDiff } from './types.js';
/**
 * Compute a capability diff between two manifest versions.
 * This is the core P0 algorithm.
 */
export declare function computeDiff(from: ServerManifest, to: ServerManifest): CapabilityDiff;
//# sourceMappingURL=compute.d.ts.map