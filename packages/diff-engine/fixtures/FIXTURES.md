# Diff Engine Fixture Matrix

All fixtures follow the naming pattern: `fixture-NN-name-from.json` and `fixture-NN-name-to.json`

## Capability Changes (6 fixtures)

### Fixture 01: Pure Addition
**From:** reader [read repo:owner/name]  
**To:** reader [read repo:owner/name] + writer [read repo:owner/name, write repo:owner/name]  
**Expected summary:** "New tool added: file_writer with write access to repository."  
**Severity:** medium (new tool, new capability)  
**newly_destructive:** false (tool itself doesn't start with write, it's only new)

### Fixture 02: Pure Removal
**From:** reader [read], writer [read, write]  
**To:** reader [read]  
**Expected summary:** "File writer tool removed; no longer has write access to repository."  
**Severity:** low (removal is safe)  
**newly_destructive:** false

### Fixture 03: Scope Widening
**From:** reader [read repo:owner/name]  
**To:** reader [read repo:*]  
**Expected summary:** "File reader now has read access to all repositories (previously scoped to owner/name)."  
**Severity:** medium (same verb, wider scope)  
**newly_destructive:** false  
**Tier:** 2 (scope_expansion)

### Fixture 04: Scope Narrowing
**From:** reader [read repo:*]  
**To:** reader [read repo:owner/name]  
**Expected summary:** "File reader scope narrowed to repository owner/name (previously read all repositories)."  
**Severity:** low (contraction)  
**newly_destructive:** false  
**Tier:** 3 (scope_narrowing)

### Fixture 05: Description-Only Change
**From:** reader [read repo:owner/name], description="Read files from repo"  
**To:** reader [read repo:owner/name], description="Read files from repository (now with improved performance)"  
**Expected summary:** "No capability changes detected."  
**Severity:** none  
**newly_destructive:** false  
**Tier:** 4 (cosmetic)

### Fixture 06: Newly Destructive Verb on Existing Tool
**From:** reader [read repo:owner/name]  
**To:** reader [read repo:owner/name, write repo:owner/name]  
**Expected summary:** "File reader now has write access to repository (previously read-only)."  
**Severity:** high (newly destructive)  
**newly_destructive:** true  
**Tier:** 1 (categorical_acquisition)

## Tool-Level Changes (2 fixtures)

### Fixture 07: Brand-New Tool with Destructive Verb
**From:** reader [read repo:owner/name]  
**To:** reader [read repo:owner/name] + deleter [read repo:owner/name, delete repo:owner/name]  
**Expected summary:** "New tool added: file_deleter with delete access to repository."  
**Severity:** high (new destructive capability)  
**newly_destructive:** true  
**Tier:** 1 (categorical_acquisition — tool has no prior version, so "acquiring" delete is Tier 1)

### Fixture 08: Tool Removed Entirely
**From:** reader [read], deleter [delete]  
**To:** reader [read]  
**Expected summary:** "File deleter tool removed; no longer has delete access to repository."  
**Severity:** low (removal is safe)  
**newly_destructive:** false

## Credential Changes (3 fixtures)

### Fixture 09: New Required Secret, No Reuse
**From:** reader uses GITHUB_TOKEN, no SLACK_BOT_TOKEN  
**To:** reader uses GITHUB_TOKEN + notifier uses SLACK_BOT_TOKEN (new, required)  
**Expected summary:** "New tool requires new credential: SLACK_BOT_TOKEN (Slack bot token)."  
**Severity:** high (new destructive capability + new required credential)  
**newly_destructive:** true (notifier has delete... wait, it has send. send is not destructive. Let me re-read.)  

Actually, looking back at the fixture, notifier only has `send` capability. So this fixture is:
- New tool: notifier
- New capability: send to slack
- New credential: SLACK_BOT_TOKEN (required)

Send is not destructive (read, fetch, send are all non-destructive; write, delete, execute are destructive).

**Corrected Expected summary:** "New tool added: slack_notifier with send access; requires new credential: SLACK_BOT_TOKEN."  
**Severity:** medium (new non-destructive capability + new required credential)  
**newly_destructive:** false

### Fixture 10: New Tool Reusing Existing Secret
**From:** reader uses GITHUB_TOKEN  
**To:** reader uses GITHUB_TOKEN + committer uses GITHUB_TOKEN (existing secret, reused)  
**Expected summary:** "New tool added: git_committer with write access to repository; reuses existing credential GITHUB_TOKEN."  
**Severity:** medium (new destructive capability but reuses existing secret, not a new secret)  
**newly_destructive:** true (committer has write capability)

### Fixture 11: Secret Flipping Required: false → true
**From:** notifier uses SLACK_BOT_TOKEN (required: false, optional)  
**To:** notifier uses SLACK_BOT_TOKEN (required: true, mandatory)  
**Expected summary:** "Credential requirement changed: SLACK_BOT_TOKEN is now required (previously optional)."  
**Severity:** medium (graceful degradation disappears)  
**newly_destructive:** false  
**Tier:** required_changed (not new, not reused, but behavior changed)

## No-Op Change (1 fixture)

### Fixture 12: No-Op Version Bump
**From:** version 1.0.0, checksum sha256:from12  
**To:** version 1.0.1, checksum sha256:to12 (all capabilities identical)  
**Expected summary:** "No capability changes detected."  
**Severity:** none  
**newly_destructive:** false  
**hasChanges:** false

---

## Test Assertion Method

For each fixture, the test will:
1. Load `fixture-NN-name-from.json` and `fixture-NN-name-to.json`
2. Compute the diff
3. Assert: `rendered_diff.includes(expected_summary)`

The human-readable renderer must produce language that, when read aloud, matches the expected summary.

## Rendering Rules (locked)

1. **Severity-ordered output:** Tier 1 changes first, then Tier 2, then Tier 3, then Tier 4. Within each tier, group by tool_id.
2. **Never render by manifest array order.**
3. **Combine capability + credential information:** if a single change involves both (e.g., new tool with new secret), render them together.
4. **newly_destructive gate:** if true, lead with a clear warning (e.g., "⚠️  HIGH RISK: ...").
5. **No silent success:** if hasChanges is false, render "No capability changes detected" (do not render empty diff).
