import type { Verb, Provenance, CapabilityEntry } from '@scopewatch/manifest';
/**
 * A single capability changed between two versions.
 */
export type CapabilityChange = {
    tool_id: string;
    verb: Verb;
    resource: string | undefined;
    changeType: 'added' | 'removed' | 'modified';
    severity: 'categorical_acquisition' | 'scope_expansion' | 'scope_narrowing' | 'cosmetic';
    provenance: Provenance;
    previousResource: string | undefined;
};
/**
 * A single credential changed between two versions.
 * Four-state model, not two:
 * - new: new secret introduced
 * - reused: existing secret now used by additional tools
 * - removed: secret no longer required
 * - required_changed: secret's required field changed (false→true means graceful degradation disappears)
 */
export type CredentialChange = {
    secret_id: string;
    changeType: 'new' | 'reused' | 'removed' | 'required_changed';
    description: string;
    used_by_new_tools: string[] | undefined;
    requiredBefore: boolean | undefined;
    requiredAfter: boolean | undefined;
};
/**
 * Complete diff between two manifest versions.
 * Organized by change type and severity.
 */
export type CapabilityDiff = {
    from_version: string;
    to_version: string;
    capabilities: {
        added: CapabilityChange[];
        removed: CapabilityChange[];
        modified: CapabilityChange[];
    };
    secrets: {
        new: CredentialChange[];
        reused: CredentialChange[];
        removed: CredentialChange[];
        required_changed: CredentialChange[];
    };
    newly_destructive: boolean;
    riskLevel: 'none' | 'low' | 'medium' | 'high';
    hasChanges: boolean;
};
/**
 * Internal: indexed capability for diff computation.
 */
export type IndexedCapability = {
    capability: CapabilityEntry;
    inVersion: 'from' | 'to' | 'both';
};
/**
 * Internal: index of capabilities keyed by (tool_id, verb, resource).
 */
export type CapabilityIndex = Map<string, CapabilityEntry>;
/**
 * Internal: for organizing changes by tool for severity assessment.
 */
export type ToolCapabilityDelta = {
    tool_id: string;
    from: Map<string, CapabilityEntry>;
    to: Map<string, CapabilityEntry>;
};
//# sourceMappingURL=types.d.ts.map