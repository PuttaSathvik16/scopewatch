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
 *
 * Strategy: index by (tool_id, verb) to properly detect scope changes.
 * A scope change is when the same (tool_id, verb) pair has different resources.
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
      // Tool removal is marked as scope_narrowing, but we need to detect "tool_removed" case
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
        // For a completely new tool, classify each capability
        // If tool is new and has ANY destructive verb → Tier 1 categorical_acquisition
        // Otherwise, non-destructive adds are cosmetic
        const hasDestructive = Array.from(toCaps.values()).some(c => isDestructive(c.verb));
        const severity = hasDestructive && isDestructive(cap.verb) ? 'categorical_acquisition' : 'cosmetic';

        added.push({
          tool_id: toolId,
          verb: cap.verb,
          resource: cap.resource,
          changeType: 'added',
          severity,
          provenance: cap.provenance,
          previousResource: undefined,
          isNewTool: true, // Mark that this tool is brand new
        });
      }
      continue;
    }

    // Tool exists in both; compare capabilities at (tool_id, verb) level
    if (fromCaps && toCaps) {
      // Group by verb to detect scope changes
      const allVerbs = new Set<Verb>();
      for (const cap of fromCaps.values()) allVerbs.add(cap.verb);
      for (const cap of toCaps.values()) allVerbs.add(cap.verb);

      for (const verb of allVerbs) {
        // Collect all resources for this (tool_id, verb) pair
        const fromResources = Array.from(fromCaps.values())
          .filter(c => c.verb === verb)
          .map(c => c.resource);
        const toResources = Array.from(toCaps.values())
          .filter(c => c.verb === verb)
          .map(c => c.resource);

        // If either from or to is empty, it's an addition or removal
        if (fromResources.length === 0 && toResources.length > 0) {
          // New verb on existing tool
          for (const toResource of toResources) {
            const toCap = Array.from(toCaps.values()).find(c => c.verb === verb && c.resource === toResource)!;
            const severity = classifyAddedCapability(toolId, toCap, fromCaps);
            added.push({
              tool_id: toolId,
              verb,
              resource: toResource,
              changeType: 'added',
              severity,
              provenance: toCap.provenance,
              previousResource: undefined,
            });
          }
        } else if (fromResources.length > 0 && toResources.length === 0) {
          // Verb entirely removed
          for (const fromResource of fromResources) {
            const fromCap = Array.from(fromCaps.values()).find(c => c.verb === verb && c.resource === fromResource)!;
            removed.push({
              tool_id: toolId,
              verb,
              resource: fromResource,
              changeType: 'removed',
              severity: 'scope_narrowing',
              provenance: fromCap.provenance,
              previousResource: undefined,
            });
          }
        } else if (fromResources.length === 1 && toResources.length === 1) {
          // Single resource per verb in both versions → check for scope change
          const fromResource = fromResources[0]!;
          const toResource = toResources[0]!;

          if (fromResource !== toResource) {
            const toCap = Array.from(toCaps.values()).find(c => c.verb === verb && c.resource === toResource)!;
            const severity = classifyScopeChange(fromResource, toResource, verb);

            if (severity !== 'cosmetic') {
              modified.push({
                tool_id: toolId,
                verb,
                resource: toResource,
                changeType: 'modified',
                severity,
                provenance: toCap.provenance,
                previousResource: fromResource,
              });
            }
          }
        } else {
          // Multiple resources before/after for the same (tool_id, verb)
          // Detect additions/removals/widening independently per resource
          const fromSet = new Set(fromResources);
          const toSet = new Set(toResources);

          for (const fromRes of fromResources) {
            if (!toSet.has(fromRes)) {
              // This resource was removed. Check if it's subsumed by a wider resource in "to"
              const isSubsumedByWider = toResources.some(toRes => isScopeWider(fromRes, toRes));
              const fromCap = Array.from(fromCaps.values()).find(c => c.verb === verb && c.resource === fromRes)!;

              if (isSubsumedByWider) {
                // The resource was subsumed by a wider one → this is part of a widening change
                // Mark it as a modification on the wider resource instead
                // (The matching "added" wider resource will be classified as scope_expansion)
              } else {
                // Standalone removal
                removed.push({
                  tool_id: toolId,
                  verb,
                  resource: fromRes,
                  changeType: 'removed',
                  severity: 'scope_narrowing',
                  provenance: fromCap.provenance,
                  previousResource: undefined,
                });
              }
            }
          }

          for (const toRes of toResources) {
            if (!fromSet.has(toRes)) {
              // This resource was added. Check if it's a widening of an existing resource
              const matchingNarrower = fromResources.find(fromRes => isScopeWider(fromRes, toRes));
              const toCap = Array.from(toCaps.values()).find(c => c.verb === verb && c.resource === toRes)!;

              if (matchingNarrower) {
                // This is a widening of an existing resource
                modified.push({
                  tool_id: toolId,
                  verb,
                  resource: toRes,
                  changeType: 'modified',
                  severity: 'scope_expansion',
                  provenance: toCap.provenance,
                  previousResource: matchingNarrower,
                });
              } else {
                // Standalone addition (new resource, different from any existing one)
                added.push({
                  tool_id: toolId,
                  verb,
                  resource: toRes,
                  changeType: 'added',
                  severity: 'cosmetic', // Non-destructive additional resource
                  provenance: toCap.provenance,
                  previousResource: undefined,
                });
              }
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
 * Check if toScope is wider than fromScope per the resource grammar.
 * Resource format: domain:path with /–delimited segments and trailing * for wildcards.
 *
 * A pattern matches another if:
 * - Same domain
 * - toPath contains everything fromPath matches, plus at least one thing it doesn't
 *
 * Examples of widening:
 * - repo:owner/name → repo:* (specific → all)
 * - repo:owner/name → repo:owner/* (specific → directory level)
 * - repo:owner/* → repo:* (directory → all)
 */
function isScopeWider(fromScope: string | undefined, toScope: string | undefined): boolean {
  if (!fromScope || !toScope) return false;
  if (fromScope === toScope) return false; // No change

  const fromParts = fromScope.split(':');
  const toParts = toScope.split(':');

  if (fromParts.length !== 2 || toParts.length !== 2) return false;
  if (fromParts[0] !== toParts[0]) return false; // Different resource domains

  const fromDomain = fromParts[0]!;
  const fromPath = fromParts[1]!;
  const toPath = toParts[1]!;

  // Both are wildcards → no change
  if (toPath === '*' && fromPath === '*') return false;

  // To is global wildcard → always wider (unless from already is)
  if (toPath === '*' && fromPath !== '*') return true;

  // To is directory wildcard, from is not → potentially wider
  // E.g., repo:owner/* vs repo:owner/name
  if (toPath.endsWith('/*') && !fromPath.endsWith('/*') && !fromPath.endsWith('*')) {
    const toDir = toPath.slice(0, -2); // Remove trailing /*
    return fromPath.startsWith(toDir + '/');
  }

  // Both have wildcards at same level → not wider
  // E.g., repo:owner/* vs repo:owner/* (equal)
  if (toPath.endsWith('/*') && fromPath.endsWith('/*')) {
    return toPath.length > fromPath.length && fromPath.startsWith(toPath.slice(0, -2));
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
 * Follows the locked mapping exactly:
 * - high: any categorical_acquisition, OR any new required secret with no reuse
 * - medium: any scope_expansion, OR new required secret reusing existing credential, OR required_changed
 * - low: only removals/narrowing, OR reused secret with no other changes
 * - none: cosmetic-only or no changes
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

  // HIGH RISK: Tier 1 (newly destructive capability)
  if (newly_destructive) {
    return 'high';
  }

  // HIGH RISK: Any new required secret with no reuse (locked rule, independent of capability tier)
  if (secretChanges.new.length > 0) {
    return 'high';
  }

  // MEDIUM RISK: Tier 2 changes (scope expansion)
  if (capabilityChanges.modified.some(c => c.severity === 'scope_expansion')) {
    return 'medium';
  }

  // MEDIUM RISK: New non-destructive capabilities
  if (capabilityChanges.added.some(c => c.severity !== 'categorical_acquisition')) {
    return 'medium';
  }

  // MEDIUM RISK: Reused secret (existing secret used by new tools)
  if (secretChanges.reused.length > 0) {
    return 'medium';
  }

  // MEDIUM RISK: Secret requirement changed (graceful degradation disappears)
  if (secretChanges.required_changed.length > 0) {
    return 'medium';
  }

  // LOW RISK: Only removals and scope narrowing
  return 'low';
}
