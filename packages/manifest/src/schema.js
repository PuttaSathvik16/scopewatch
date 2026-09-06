import { z } from 'zod';
// Verb vocabulary: each maps to a distinct threat model
export const VerbSchema = z.enum([
    'read', // read access to data
    'fetch', // reach out and pull something back (SSRF/prompt-injection risk)
    'send', // push data externally (exfiltration risk)
    'write', // write access to data
    'delete', // delete data
    'execute', // execute commands/code
]);
// Provenance: was this verb declared explicitly or inferred from tool analysis?
export const ProvenanceSchema = z.enum(['declared', 'inferred']);
// A single capability granted by a tool
export const CapabilityEntrySchema = z.object({
    tool_id: z.string().min(1, 'tool_id must not be empty'),
    verb: VerbSchema,
    resource: z.string().optional().describe('Resource identifier (e.g., "repo:owner/name", "filesystem:/*")'),
    provenance: ProvenanceSchema,
    description: z.string().optional().describe('Explanation for inferred verbs'),
});
// A secret required by one or more tools
export const SecretDeclarationSchema = z.object({
    id: z.string().min(1, 'Secret id must not be empty').regex(/^[A-Z_][A-Z0-9_]*$/, 'Secret id must be uppercase with underscores'),
    description: z.string().min(1, 'description must not be empty'),
    required: z.boolean(),
    used_by: z.array(z.string().min(1)).describe('tool_ids that reference this secret'),
});
// Minimal tool metadata (capabilities are hoisted to manifest root)
export const ToolDeclarationSchema = z.object({
    id: z.string().min(1, 'tool id must not be empty'),
    name: z.string().min(1, 'name must not be empty'),
    description: z.string().min(1, 'description must not be empty'),
});
// Source location for the server
export const SourceSchema = z.object({
    type: z.enum(['npm', 'git', 'local']).describe('Source type'),
    location: z.string().min(1, 'location must not be empty').describe('Package name, git URL, or local path'),
});
// Optional metadata about the server
export const MetadataSchema = z.object({
    author: z.string().optional(),
    license: z.string().optional(),
    homepage: z.string().url('homepage must be a valid URL').optional(),
}).optional();
// The canonical server manifest
export const ServerManifestSchema = z.object({
    schemaVersion: z.literal(1).describe('Manifest schema version'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver (e.g., "1.2.0")'),
    source: SourceSchema,
    checksum: z.string().min(1, 'checksum must not be empty').describe('sha256 hash of server artifact'),
    tools: z.array(ToolDeclarationSchema).min(1, 'at least one tool must be declared'),
    capabilities: z.array(CapabilityEntrySchema).min(0).describe('Hoisted to root for diff clarity'),
    secrets: z.array(SecretDeclarationSchema).min(0).describe('Secrets with usage tracking'),
    metadata: MetadataSchema,
});
/**
 * Parse and validate a server manifest from JSON.
 * Returns detailed, human-readable errors on failure.
 */
export function parseManifest(input) {
    const result = ServerManifestSchema.safeParse(input);
    if (result.success) {
        return { ok: true, value: result.data };
    }
    const errors = result.error.issues.map(issue => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
    }));
    return { ok: false, errors };
}
/**
 * Validate a manifest instance. Useful after round-trip deserialization.
 */
export function validateManifest(manifest) {
    return parseManifest(manifest);
}
/**
 * Type guard: is this a valid ServerManifest?
 */
export function isServerManifest(value) {
    const result = ServerManifestSchema.safeParse(value);
    return result.success;
}
//# sourceMappingURL=schema.js.map