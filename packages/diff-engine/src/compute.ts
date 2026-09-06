import type { ServerManifest, CapabilityEntry, SecretDeclaration, Verb } from '@scopewatch/manifest';
import type { CapabilityDiff, CapabilityChange, CredentialChange, ToolCapabilityDelta } from './types.js';

/**
 * Compute a capability diff between two manifest versions.
 * This is the core P0 algorithm.
 */
export function computeDiff(from: ServerManifest, to: ServerManifest): CapabilityDiff {
  // Index capabilities by tool and (verb, resource) pair
  const fromByTool = indexCapabilitiesByTool(from.capabilities);
  const toByTool = indexCapabilitiesByTool(to.capabilities);

  // Compute capability changes
  const capabilityChanges = computeCapabilityChanges(fromByTool, toByTool);

  // Compute credential changes
  const secretChanges = computeSecretChanges(from.secrets, to.secrets);

  // Determine risk level
  // Tier 1: categorical acquisition in either added (new tool with destructive) or modified (existing tool gains destructive)
  const newly_destructive =
    capabilityChanges.added.some(c => c.severity === 'categorical_acquisition') ||
    capabilityChanges.modified.some(c => c.severity === 'categorical_acquisition');

  const riskLevel = determineRiskLevel(capabilityChanges, secretChanges, newly_destructive);

  const hasChanges =
    capabilityChanges.added.length > 0 ||
    capabilityChanges.removed.length > 0 ||
    capabilityChanges.modified.length > 0 ||
    secretChanges.new.length > 0 ||
    secretChanges.reused.length > 0 ||
    secretChanges.removed.length > 0 ||
    secretChanges.required_changed.length > 0;

  return {
    from_version: from.version,
    to_version: to.version,
    capabilities: capabilityChanges,
    secrets: secretChanges,
    newly_destructive,
    riskLevel,
    hasChanges,
  };
}

/**
 * Index capabilities by tool_id.
 */
function indexCapabilitiesByTool(
  capabilities: CapabilityEntry[]
): Map<string, Map<string, CapabilityEntry>> {
  const index = new Map<string, Map<string, CapabilityEntry>>();

  for (const cap of capabilities) {
    if (!index.has(cap.tool_id)) {
      index.set(cap.tool_id, new Map());
    }

    const key = `${cap.verb}:${cap.resource ?? ''}`;
    index.get(cap.tool_id)!.set(key, cap);
  }

  return index;
}

/**
 * Compute all capability changes between two versions.
 */
function computeCapabilityChanges(
  fromByTool: Map<string, Map<string, CapabilityEntry>>,
  toByTool: Map<string, Map<string, CapabilityEntry>>
): { added: CapabilityChange[]; removed: CapabilityChange[]; modified: CapabilityChange[] } {
  const added: CapabilityChange[] = [];
  const removed: CapabilityChange[] = [];
  const modified: CapabilityChange[] = [];

  const allToolIds = new Set([...fromByTool.keys(), ...toByTool.keys()]);

  for (const toolId of allToolIds) {
    const fromCaps = fromByTool.get(toolId);
    const toCaps = toByTool.get(toolId);

    // Tool entirely removed
    if (!toCaps && fromCaps) {
      for (const cap of fromCaps.values()) {
        removed.push({
          tool_id: toolId,
          verb: cap.verb,
          resource: cap.resource,
          changeType: 'removed',
          severity: 'scope_narrowing', // tool removal is a narrowing
          provenance: cap.provenance,
          previousResource: undefined,
        });
      }
      continue;
    }

    // Tool entirely added
    if (!fromCaps && toCaps) {
      for (const cap of toCaps.values()) {
        const severity = isDestructive(cap.verb) ? 'categorical_acquisition' : 'cosmetic';
        added.push({
          tool_id: toolId,
          verb: cap.verb,
          resource: cap.resource,
          changeType: 'added',
          severity,
          provenance: cap.provenance,
          previousResource: undefined,
        });
      }
      continue;
    }

    // Tool exists in both; compare capabilities
    if (fromCaps && toCaps) {
      const allKeys = new Set([...fromCaps.keys(), ...toCaps.keys()]);

      for (const key of allKeys) {
        const fromCap = fromCaps.get(key);
        const toCap = toCaps.get(key);

        if (!toCap && fromCap) {
          // Capability removed
          removed.push({
            tool_id: toolId,
            verb: fromCap.verb,
            resource: fromCap.resource,
            changeType: 'removed',
            severity: 'scope_narrowing',
            provenance: fromCap.provenance,
            previousResource: undefined,
          });
        } else if (!fromCap && toCap) {
          // Capability added to existing tool
          const severity = classifyAddedCapability(toolId, toCap, fromCaps);
          added.push({
            tool_id: toolId,
            verb: toCap.verb,
            resource: toCap.resource,
            changeType: 'added',
            severity,
            provenance: toCap.provenance,
            previousResource: undefined,
          });
        } else if (fromCap && toCap) {
          // Both exist; check for changes
          if (fromCap.resource !== toCap.resource || fromCap.description !== toCap.description) {
            // Resource changed (scope widening/narrowing) or description changed
            const severity = classifyScopeChange(fromCap.resource, toCap.resource, fromCap.verb);

            if (severity !== 'cosmetic') {
              modified.push({
                tool_id: toolId,
                verb: fromCap.verb,
                resource: toCap.resource,
                changeType: 'modified',
                severity,
                provenance: toCap.provenance,
                previousResource: fromCap.resource,
              });
            } else if (fromCap.description !== toCap.description) {
              // Description-only change
              modified.push({
                tool_id: toolId,
                verb: fromCap.verb,
                resource: toCap.resource,
                changeType: 'modified',
                severity: 'cosmetic',
                provenance: toCap.provenance,
                previousResource: undefined,
              });
            }
          }
        }
      }
    }
  }

  return { added, removed, modified };
}

/**
 * Classify the severity of a newly added capability to an existing tool.
 * Tier 1: tool goes from having zero destructive verbs to having any destructive verb.
 */
function classifyAddedCapability(
  toolId: string,
  toCap: CapabilityEntry,
  fromCaps: Map<string, CapabilityEntry>
): 'categorical_acquisition' | 'cosmetic' {
  if (!isDestructive(toCap.verb)) {
    return 'cosmetic'; // Non-destructive additions are cosmetic
  }

  // Check if tool previously had ANY destructive verb
  // If it didn't, then adding one is Tier 1 (categorical_acquisition)
  // If it did, then adding another one is cosmetic (not Tier 1)
  for (const cap of fromCaps.values()) {
    if (isDestructive(cap.verb)) {
      return 'cosmetic'; // Tool already had destructive access, so no new category acquired
    }
  }

  // Tool had NO destructive verbs before, now adding one → Tier 1
  return 'categorical_acquisition';
}

/**
 * Classify the severity of a scope change.
 */
function classifyScopeChange(
  fromResource: string | undefined,
  toResource: string | undefined,
  verb: Verb
): 'scope_expansion' | 'scope_narrowing' | 'cosmetic' {
  if (fromResource === toResource) {
    return 'cosmetic'; // No change
  }

  // Simple heuristic: if "to" is wider than "from", it's an expansion
  // E.g., "repo:owner/name" → "repo:*" is an expansion
  if (isScopeWider(fromResource, toResource)) {
    return 'scope_expansion';
  }

  if (isScopeNarrower(fromResource, toResource)) {
    return 'scope_narrowing';
  }

  return 'cosmetic'; // Unknown relationship, treat as cosmetic
}

/**
 * Check if toScope is wider than fromScope.
 * Simple implementation: ":" → "*" pattern.
 */
function isScopeWider(fromScope: string | undefined, toScope: string | undefined): boolean {
  if (!fromScope || !toScope) return false;

  // repo:owner/name → repo:* is wider
  const fromParts = fromScope.split(':');
  const toParts = toScope.split(':');

  if (fromParts[0] !== toParts[0]) return false; // Different resource types

  if (toParts[1] === '*' && fromParts[1] !== '*') {
    return true;
  }

  return false;
}

/**
 * Check if toScope is narrower than fromScope.
 */
function isScopeNarrower(fromScope: string | undefined, toScope: string | undefined): boolean {
  return isScopeWider(toScope, fromScope); // Symmetry
}

/**
 * Is this verb destructive? (write, delete, execute)
 */
function isDestructive(verb: Verb): boolean {
  return verb === 'write' || verb === 'delete' || verb === 'execute';
}

/**
 * Compute credential changes between two versions.
 */
function computeSecretChanges(
  fromSecrets: SecretDeclaration[],
  toSecrets: SecretDeclaration[]
): {
  new: CredentialChange[];
  reused: CredentialChange[];
  removed: CredentialChange[];
  required_changed: CredentialChange[];
} {
  const newSecrets: CredentialChange[] = [];
  const reusedSecrets: CredentialChange[] = [];
  const removedSecrets: CredentialChange[] = [];
  const requiredChanged: CredentialChange[] = [];

  const fromById = new Map(fromSecrets.map(s => [s.id, s]));
  const toById = new Map(toSecrets.map(s => [s.id, s]));

  // Find new and reused secrets
  for (const toSecret of toSecrets) {
    const fromSecret = fromById.get(toSecret.id);

    if (!fromSecret) {
      // Genuinely new secret
      newSecrets.push({
        secret_id: toSecret.id,
        changeType: 'new',
        description: toSecret.description,
        used_by_new_tools: undefined,
        requiredBefore: undefined,
        requiredAfter: undefined,
      });
    } else {
      // Existing secret
      if (toSecret.used_by.length > fromSecret.used_by.length) {
        // New tools now using this secret
        const newToolIds = toSecret.used_by.filter(t => !fromSecret.used_by.includes(t));
        reusedSecrets.push({
          secret_id: toSecret.id,
          changeType: 'reused',
          description: toSecret.description,
          used_by_new_tools: newToolIds,
          requiredBefore: undefined,
          requiredAfter: undefined,
        });
      }

      // Check if required status changed
      if (fromSecret.required !== toSecret.required) {
        requiredChanged.push({
          secret_id: toSecret.id,
          changeType: 'required_changed',
          description: toSecret.description,
          used_by_new_tools: undefined,
          requiredBefore: fromSecret.required,
          requiredAfter: toSecret.required,
        });
      }
    }
  }

  // Find removed secrets
  for (const fromSecret of fromSecrets) {
    if (!toById.has(fromSecret.id)) {
      removedSecrets.push({
        secret_id: fromSecret.id,
        changeType: 'removed',
        description: fromSecret.description,
        used_by_new_tools: undefined,
        requiredBefore: undefined,
        requiredAfter: undefined,
      });
    }
  }

  return {
    new: newSecrets,
    reused: reusedSecrets,
    removed: removedSecrets,
    required_changed: requiredChanged,
  };
}

/**
 * Determine overall risk level for the update.
 * Tiers: 1=high, 2=medium, 3&4=low, but new tools/secrets can elevate
 */
function determineRiskLevel(
  capabilityChanges: {
    added: CapabilityChange[];
    removed: CapabilityChange[];
    modified: CapabilityChange[];
  },
  secretChanges: {
    new: CredentialChange[];
    reused: CredentialChange[];
    removed: CredentialChange[];
    required_changed: CredentialChange[];
  },
  newly_destructive: boolean
): 'none' | 'low' | 'medium' | 'high' {
  // No changes at all
  if (
    capabilityChanges.added.length === 0 &&
    capabilityChanges.removed.length === 0 &&
    capabilityChanges.modified.length === 0 &&
    secretChanges.new.length === 0 &&
    secretChanges.reused.length === 0 &&
    secretChanges.removed.length === 0 &&
    secretChanges.required_changed.length === 0
  ) {
    return 'none';
  }

  // Tier 1 (newly destructive) → high
  if (newly_destructive) {
    return 'high';
  }

  // New required secrets → high
  if (secretChanges.new.length > 0) {
    return 'high';
  }

  // Tier 2 changes (scope expansion) → medium
  if (capabilityChanges.modified.some(c => c.severity === 'scope_expansion')) {
    return 'medium';
  }

  // New non-destructive capabilities → medium
  if (capabilityChanges.added.some(c => c.severity !== 'categorical_acquisition')) {
    return 'medium';
  }

  // Secret requirement changed → medium
  if (secretChanges.required_changed.length > 0) {
    return 'medium';
  }

  // Only removals and scope narrowing → low
  return 'low';
}
