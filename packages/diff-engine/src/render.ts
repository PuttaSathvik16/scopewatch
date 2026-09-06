import type { CapabilityDiff, CapabilityChange } from './types.js';

/**
 * Render a capability diff to human-readable plain text.
 * Critical: output must be a one-sentence summary a human can understand without the manifests.
 *
 * Rendering order: severity descending (Tier 1 first), then grouped by tool.
 */
export function renderDiff(diff: CapabilityDiff): string {
  const lines: string[] = [];

  // Header: version info
  lines.push(`→ Update: ${diff.from_version} → ${diff.to_version}`);
  lines.push('');

  // No changes: silent success must explicitly state this
  if (!diff.hasChanges) {
    lines.push('✓ No capability changes detected.');
    return lines.join('\n');
  }

  // Render capabilities in severity order
  if (diff.newly_destructive) {
    lines.push('⚠️  HIGH RISK: Newly destructive capability detected');
    lines.push('');

    // Tier 1: Categorical acquisition
    const tier1 = [
      ...diff.capabilities.added.filter(c => c.severity === 'categorical_acquisition'),
      ...diff.capabilities.modified.filter(c => c.severity === 'categorical_acquisition'),
    ];

    const tier1ByTool = groupByTool(tier1);
    for (const [toolId, changes] of tier1ByTool) {
      for (const change of changes) {
        lines.push(`  • ${toolId}: added ${change.verb} access to ${change.resource ?? 'default'}`);
        if (change.changeType === 'modified' && change.previousResource) {
          lines.push(`    (previously read-only or scoped to ${change.previousResource})`);
        }
      }
    }
    lines.push('');
  }

  // Tier 2: Scope expansion
  const tier2 = diff.capabilities.modified.filter(c => c.severity === 'scope_expansion');
  if (tier2.length > 0) {
    lines.push('🔄 SCOPE EXPANDED:');
    const tier2ByTool = groupByTool(tier2);
    for (const [toolId, changes] of tier2ByTool) {
      for (const change of changes) {
        lines.push(
          `  • ${toolId}: now has ${change.verb} access to ${change.resource ?? 'default'} ` +
            `(previously ${change.previousResource ?? 'default'})`
        );
      }
    }
    lines.push('');
  }

  // Tier 3: Scope narrowing
  const tier3 = [
    ...diff.capabilities.removed.filter(c => c.severity === 'scope_narrowing'),
    ...diff.capabilities.modified.filter(c => c.severity === 'scope_narrowing'),
  ];
  if (tier3.length > 0) {
    lines.push('✓ SCOPE NARROWED (safer):');
    const tier3ByTool = groupByTool(tier3);
    for (const [toolId, changes] of tier3ByTool) {
      for (const change of changes) {
        if (change.changeType === 'removed') {
          lines.push(`  • ${toolId}: removed ${change.verb} access`);
        } else {
          lines.push(
            `  • ${toolId}: ${change.verb} scope narrowed to ${change.resource ?? 'default'}`
          );
        }
      }
    }
    lines.push('');
  }

  // Tier 4: Cosmetic (only if there are Tier 4 changes and no higher tiers)
  const tier4 = diff.capabilities.modified.filter(c => c.severity === 'cosmetic');
  if (
    tier4.length > 0 &&
    !diff.newly_destructive &&
    tier2.length === 0 &&
    tier3.length === 0
  ) {
    lines.push('ℹ️  DESCRIPTION UPDATED:');
    for (const change of tier4) {
      lines.push(`  • ${change.tool_id}: description updated`);
    }
    lines.push('');
  }

  // New tools (not already covered by Tier 1)
  const tier1ToolIds = new Set(
    [
      ...diff.capabilities.added.filter(c => c.severity === 'categorical_acquisition'),
      ...diff.capabilities.modified.filter(c => c.severity === 'categorical_acquisition'),
    ].map(c => c.tool_id)
  );
  const newToolsNotTier1 = diff.capabilities.added.filter(
    c => c.severity !== 'categorical_acquisition' && !tier1ToolIds.has(c.tool_id)
  );
  if (newToolsNotTier1.length > 0) {
    lines.push('🆕 NEW CAPABILITIES:');
    const toolIds = new Set(newToolsNotTier1.map(c => c.tool_id));
    for (const toolId of toolIds) {
      const caps = newToolsNotTier1.filter(c => c.tool_id === toolId);
      const verbs = caps.map(c => c.verb).join(', ');
      lines.push(`  • ${toolId}: [${verbs}]`);
    }
    lines.push('');
  }

  // Render credentials
  if (
    diff.secrets.new.length > 0 ||
    diff.secrets.reused.length > 0 ||
    diff.secrets.removed.length > 0 ||
    diff.secrets.required_changed.length > 0
  ) {
    lines.push('🔑 CREDENTIALS:');

    // New secrets
    for (const secret of diff.secrets.new) {
      lines.push(`  • NEW REQUIRED: ${secret.secret_id} (${secret.description})`);
    }

    // Reused secrets
    for (const secret of diff.secrets.reused) {
      const toolList = (secret.used_by_new_tools ?? []).join(', ');
      lines.push(`  • REUSED: ${secret.secret_id} (now used by: ${toolList})`);
    }

    // Removed secrets
    for (const secret of diff.secrets.removed) {
      lines.push(`  • REMOVED: ${secret.secret_id} (no longer needed)`);
    }

    // Required status changed
    for (const secret of diff.secrets.required_changed) {
      const status = secret.requiredAfter
        ? 'now required (previously optional)'
        : 'now optional (previously required)';
      lines.push(`  • REQUIREMENT CHANGED: ${secret.secret_id} ${status}`);
    }

    lines.push('');
  }

  // Trailing note
  lines.push('Review carefully. Approve? [y/N]:');

  return lines.join('\n');
}

/**
 * Group capability changes by tool_id.
 */
function groupByTool(
  changes: CapabilityChange[]
): Map<string, CapabilityChange[]> {
  const groups = new Map<string, CapabilityChange[]>();

  for (const change of changes) {
    if (!groups.has(change.tool_id)) {
      groups.set(change.tool_id, []);
    }
    groups.get(change.tool_id)!.push(change);
  }

  return groups;
}

/**
 * Extract a one-sentence summary from the diff for testing.
 * This is what the test assertions will check against.
 */
export function extractSummary(diff: CapabilityDiff): string {
  if (!diff.hasChanges) {
    return 'No capability changes detected.';
  }

  if (diff.newly_destructive) {
    const tier1Changes = [
      ...diff.capabilities.added.filter(c => c.severity === 'categorical_acquisition'),
      ...diff.capabilities.modified.filter(c => c.severity === 'categorical_acquisition'),
    ];

    if (tier1Changes.length > 0) {
      const first = tier1Changes[0]!;
      if (first.changeType === 'added') {
        return `New tool added: ${first.tool_id} with ${first.verb} access to ${first.resource ?? 'default'}.`;
      }
      return `${first.tool_id} now has ${first.verb} access to ${first.resource ?? 'default'} (previously read-only).`;
    }
  }

  const tier2 = diff.capabilities.modified.filter(c => c.severity === 'scope_expansion');
  if (tier2.length > 0) {
    const first = tier2[0]!;
    return `${first.tool_id} now has ${first.verb} access to ${first.resource ?? 'default'} (previously scoped to ${first.previousResource ?? 'default'}).`;
  }

  const tier3 = [
    ...diff.capabilities.removed.filter(c => c.severity === 'scope_narrowing'),
    ...diff.capabilities.modified.filter(c => c.severity === 'scope_narrowing'),
  ];
  if (tier3.length > 0) {
    const first = tier3[0]!;
    if (first.changeType === 'removed') {
      return `${first.tool_id} tool removed; no longer has ${first.verb} access to ${first.resource ?? 'default'}.`;
    }
    return `${first.tool_id} scope narrowed to ${first.resource ?? 'default'} (previously ${first.previousResource ?? 'default'}).`;
  }

  if (diff.secrets.new.length > 0) {
    const secret = diff.secrets.new[0]!;
    return `New tool requires new credential: ${secret.secret_id} (${secret.description}).`;
  }

  if (diff.secrets.reused.length > 0) {
    const secret = diff.secrets.reused[0]!;
    return `New tool added; reuses existing credential ${secret.secret_id}.`;
  }

  if (diff.secrets.required_changed.length > 0) {
    const secret = diff.secrets.required_changed[0]!;
    const status = secret.requiredAfter ? 'now required' : 'now optional';
    return `Credential requirement changed: ${secret.secret_id} is ${status} (previously ${!secret.requiredAfter ? 'required' : 'optional'}).`;
  }

  // Fallback
  return 'Changes detected.';
}
