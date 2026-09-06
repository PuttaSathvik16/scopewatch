import type { McpTool, InferredCapability, InferenceResult } from './types.js';

type Verb = InferredCapability['verb'];

/**
 * Real (not real-time-negotiated) capability inference for MCP tools that
 * lack a declared manifest. Every result is tagged provenance: 'inferred' -
 * this is a best-effort heuristic, not ground truth, and callers must render
 * it with the hedged "appears to..." language Phase B already built for
 * exactly this case.
 *
 * Design validated against 14 real tools from the actual, live
 * @modelcontextprotocol/server-filesystem (see test/fixtures/real-filesystem-server-tools.json,
 * captured directly from a real tools/list response, not invented).
 */

const SEVERITY: Record<Verb, number> = { read: 0, fetch: 1, send: 1, write: 2, delete: 3, execute: 3 };

// Checked most-severe-first, so if a description contains multiple signal
// words, the more alarming one is the one that gets detected.
// NOTE: 'move'/'rename' are deliberately NOT in the write list - a relocation
// both creates at the destination and vacates the source, which is closer to
// a delete-shaped effect at the origin than a confident write signal. Left
// unmatched, it correctly falls through to the destructive-pool default.
//
// Patterns are left-anchored word STEMS (\b before, no \b after), not whole
// words - natural-language tool descriptions use conjugated forms
// ("deletes", "deleting", "created") far more often than bare infinitives,
// and \bdelete\b does not match "deletes" (no word boundary between "delete"
// and the trailing "s"). Left-anchoring on the stem catches all common
// inflections without needing to enumerate every conjugation.
// Longer, distinctive words use a left-anchored stem (catches conjugations
// like "deletes"/"deleting" without enumerating every form, since \bdelete\b
// does not match "deletes" - no word boundary between "delete" and "s").
// Short or common words (run, call, get) use exact whole-word matches
// instead, since a left-anchored stem on a short word risks false positives
// on unrelated words that merely start with it (e.g. "runtime", "callback",
// "getter").
const KEYWORD_PATTERNS: [Verb, RegExp][] = [
  ['delete', /\b(delete|remov|destroy|purg|drop)/],
  ['execute', /\b(execut|invok|spawn)|\b(run|runs|running|call|calls|calling|called)\b/],
  // 'messag' deliberately excluded: "error messages", "log messages" etc. are
  // extremely common boilerplate in tool descriptions that have nothing to do
  // with the tool sending anything - a noun/verb ambiguity that produced a
  // real false positive (read_text_file's "detailed error messages" phrase)
  // during validation against real tool data.
  ['send', /\b(send|post|publish|notif|email)/],
  ['fetch', /\b(fetch|download|pull|scrap)/],
  // 'creat' and 'modif' as bare stems are deliberately avoided: "creation
  // time"/"last modified time" are extremely common metadata-field phrases
  // (nouns/adjectives describing timestamps, as in get_file_info's own
  // description) with nothing to do with the tool creating or modifying
  // anything - the same noun/verb ambiguity as 'messag' above. Bare
  // "modified" is excluded too (it's the specific form that appears in
  // "last modified" boilerplate); "modify"/"modifies"/"modifying" - active
  // verb forms far more likely to describe a real action - are kept.
  ['write', /\b(writ|updat|edit|sav|upload)|\b(create|creates|created|creating|modify|modifies|modifying)\b/],
  ['read', /\b(read|list|search|view|inspect|quer|find)|\b(get|gets|getting)\b/],
];

function normalize(text: string): string {
  return text.replace(/[_-]/g, ' ').toLowerCase();
}

function matchKeyword(text: string): Verb | null {
  for (const [verb, pattern] of KEYWORD_PATTERNS) {
    if (pattern.test(text)) return verb;
  }
  return null;
}

function inferVerb(tool: McpTool): { verb: Verb; warnings: string[] } {
  const text = normalize(`${tool.name} ${tool.description}`);
  const keywordVerb = matchKeyword(text);
  const ann = tool.annotations;
  const warnings: string[] = [];

  if (ann?.destructiveHint === true && ann?.readOnlyHint === true) {
    warnings.push(
      `Tool '${tool.name}' declares contradictory annotations (destructiveHint and readOnlyHint both true); resolving to the more cautious (destructive) classification.`
    );
  }

  let hintVerb: Verb;
  if (ann?.destructiveHint === true) {
    hintVerb = keywordVerb === 'delete' || keywordVerb === 'execute' || keywordVerb === 'write' ? keywordVerb : 'delete';
  } else if (ann?.readOnlyHint === true) {
    hintVerb = keywordVerb === 'fetch' ? 'fetch' : 'read';
  } else if (ann && ann.destructiveHint === false && ann.readOnlyHint === false) {
    hintVerb = keywordVerb ?? 'write';
  } else {
    hintVerb = keywordVerb ?? 'execute';
  }

  let finalVerb = hintVerb;
  if (keywordVerb && SEVERITY[keywordVerb] > SEVERITY[hintVerb]) {
    warnings.push(
      `Tool '${tool.name}': keyword evidence ('${keywordVerb}') is more severe than the annotation-based classification ('${hintVerb}'); using the more cautious classification.`
    );
    finalVerb = keywordVerb;
  }

  return { verb: finalVerb, warnings };
}

const RESOURCE_PATTERNS: [string, RegExp][] = [
  ['filesystem:*', /\b(path|paths|file|filepath|directory|dir)\b/],
  ['repo:*', /\b(repo|repository)\b/],
  ['http:*', /\b(url|uri|endpoint)\b/],
];

function inferResource(tool: McpTool): string {
  // Deliberately scans ONLY the input schema's parameter names/descriptions,
  // not the tool's free-text description - a description can casually
  // mention path-shaped words ("...their nested paths...") without the tool
  // actually taking any such parameter, which would otherwise produce a
  // falsely specific resource guess instead of the honest wildcard fallback.
  const props = tool.inputSchema?.properties ?? {};
  const paramText = Object.entries(props)
    .map(([key, val]) => `${key} ${val.description ?? ''}`)
    .join(' ');
  const text = normalize(paramText);

  for (const [resource, pattern] of RESOURCE_PATTERNS) {
    if (pattern.test(text)) return resource;
  }
  return '*';
}

export function inferCapabilities(server_id: string, tools: McpTool[]): InferenceResult {
  const capabilities: InferredCapability[] = [];
  const warnings: string[] = [];

  for (const tool of tools) {
    const { verb, warnings: toolWarnings } = inferVerb(tool);
    const resource = inferResource(tool);

    capabilities.push({
      tool_id: tool.name,
      verb,
      resource,
      provenance: 'inferred',
      description: `inferred from tool name/description/schema (server: ${server_id})`,
    });
    warnings.push(...toolWarnings);
  }

  return { capabilities, warnings };
}
