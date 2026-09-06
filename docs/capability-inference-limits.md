# What Capability Inference Does and Does Not Cover

This is deliberately its own document, not a footnote in the security model
or quickstart — the capability diff is Scopewatch's entire reason to exist
(Section 1 of the product brief), and for any auto-discovered server, the
diff's accuracy is bounded by how well `@scopewatch/capability-inference`
guessed each tool's real behavior. Overclaiming precision here would
undermine the one thing this product promises to get right.

## What "inferred" actually means

The MCP registry does not provide capability metadata — no verbs, no
resource scopes. For an auto-installed server, Scopewatch determines each
tool's capability by:

1. **Reading MCP tool annotations, when the server provides them** —
   `readOnlyHint` and `destructiveHint` are optional, self-reported by the
   server's own author, not independently verified by Scopewatch or by
   the MCP protocol itself.
2. **Falling back to keyword matching** against the tool's name and
   description when annotations are absent or ambiguous.
3. **Inferring the resource scope** from the tool's declared input
   parameters (a parameter named or described as a path, repo, or URL) —
   falling back to an honest, fully unscoped `*` wildcard when no such
   signal exists, rather than guessing something more specific than the
   evidence supports.

Every result produced this way is tagged `provenance: 'inferred'` and
rendered with hedged language ("appears to have," not "has") — this is
the honest way to represent "we guessed this from a description," which is
exactly what it is. `provenance: 'declared'` is reserved for capability
data that came from an actual manifest a server author wrote — inference
never produces `'declared'` output.

## Two structural defenses, validated against real data — and their honest limit

Design and fixtures for this module were built against **14 real tools
captured from a live run of the actual, official
`@modelcontextprotocol/server-filesystem`** — not invented examples. Two
defenses were added after real false positives surfaced during that
validation:

1. **Name-first classification.** A tool's name is checked before its
   description for the "which flavor" decision (e.g. delete vs. write
   within the destructive category) — names are terse and verb-led by
   convention, with none of the incidental nouns and adjectives that
   flowing description prose carries. This structurally prevented a real
   bug: `get_file_info`'s description mentioning "**creation** time" and
   "last **modified** time" (ordinary metadata field names, not verbs) was
   initially misread as the tool performing a write action.

2. **A narrowly-scoped severity override.** A calm-sounding name must not
   be able to suppress a genuinely dangerous signal buried in a tool's
   description (a hypothetical `benign_reader` whose description admits it
   "permanently deletes" a file) — so the full description is still
   checked, but *only* for delete/execute signals specifically, not all
   six verb categories. Scanning against all six was strictly broader than
   that check's actual job, and that excess breadth is what let a stray
   `send`-shaped phrase ("detailed error **messages**" — a noun, not a
   verb) slip through even with name-first classification already in
   place.

**Verified, not assumed:** with both defenses active, every word-specific
exclusion added to patch individual false positives was temporarily
reverted, and the full fixture matrix (12 tests) still passed. That is the
actual evidence these two defenses close the *class* of noun/verb ambiguity
bug discovered so far — not just the two specific instances that happened
to surface first.

**This is not a complete solution, and is not presented as one.** A
generically-named tool (one whose name alone gives no usable signal) still
falls back to scanning its full description against all six verb
categories for its default classification — and that fallback path remains
exposed to the same kind of noun/verb ambiguity in principle. A future real
server, with different incidental wording in its tool descriptions, could
surface a new instance of this. **That is expected, not a defect** — it is
the correct, honest consequence of matching human-written natural language
with regular expressions. Treat a future occurrence as a new fixture worth
adding, the same way `get_file_info` and `read_text_file` became fixtures
here, not as evidence the module is broken.

## What this means for the capability diff you see

- A `declared` capability (from a server that publishes its own manifest)
  is exact.
- An `inferred` capability is Scopewatch's best real-world guess, built
  from real MCP protocol data (tool annotations, names, descriptions,
  parameter schemas) — meaningfully better than a guess with no structure,
  but still a guess, rendered with visibly hedged language so it is never
  confused for a verified fact.
- If an inferred capability looks wrong for a server you use, that is worth
  reporting — inference improves by adding the specific real tool that
  exposed the gap to the fixture matrix, the same process that has already
  found and fixed several real cases during this module's own development.

## Diff engine tiering scope (separate from inference, worth stating explicitly)

Independent of where a capability's verb/resource came from, the diff
engine's own severity model has a fixed, locked scope:

- **Four tiers**: categorical acquisition (a tool gains any destructive
  verb it didn't have before) → scope expansion (a destructive verb's
  resource widens) → scope narrowing (safe, still surfaced) → cosmetic
  (description-only change).
- **`newly_destructive` is the only binary gate**, and it is true if and
  only if a Tier 1 (categorical acquisition) change exists. A large Tier 2
  scope expansion — even one covering far more than before — never flips
  this gate on its own. That is a deliberate, locked design choice: if
  Tier 2 should ever block activation on its own, that is a future
  runtime-policy decision, not something this version blurs the line on by
  treating "big" as equivalent to "newly acquired."
- The diff only compares what two manifests' `capabilities` arrays say —
  it has no independent way to verify a server actually behaves as its own
  declared or inferred capabilities claim at runtime. That verification is
  what `scopewatch test`'s connection check partially covers (does the
  server actually respond to the protocol) — it does not verify that a
  tool's *behavior* matches its capability entry.

