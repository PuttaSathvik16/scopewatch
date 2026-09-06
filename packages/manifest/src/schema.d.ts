import { z } from 'zod';
export declare const VerbSchema: z.ZodEnum<["read", "fetch", "send", "write", "delete", "execute"]>;
export type Verb = z.infer<typeof VerbSchema>;
export declare const ProvenanceSchema: z.ZodEnum<["declared", "inferred"]>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export declare const CapabilityEntrySchema: z.ZodObject<{
    tool_id: z.ZodString;
    verb: z.ZodEnum<["read", "fetch", "send", "write", "delete", "execute"]>;
    resource: z.ZodOptional<z.ZodString>;
    provenance: z.ZodEnum<["declared", "inferred"]>;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    tool_id: string;
    verb: "read" | "fetch" | "send" | "write" | "delete" | "execute";
    provenance: "declared" | "inferred";
    resource?: string | undefined;
    description?: string | undefined;
}, {
    tool_id: string;
    verb: "read" | "fetch" | "send" | "write" | "delete" | "execute";
    provenance: "declared" | "inferred";
    resource?: string | undefined;
    description?: string | undefined;
}>;
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;
export declare const SecretDeclarationSchema: z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    required: z.ZodBoolean;
    used_by: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    description: string;
    id: string;
    required: boolean;
    used_by: string[];
}, {
    description: string;
    id: string;
    required: boolean;
    used_by: string[];
}>;
export type SecretDeclaration = z.infer<typeof SecretDeclarationSchema>;
export declare const ToolDeclarationSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
}, "strip", z.ZodTypeAny, {
    description: string;
    id: string;
    name: string;
}, {
    description: string;
    id: string;
    name: string;
}>;
export type ToolDeclaration = z.infer<typeof ToolDeclarationSchema>;
export declare const SourceSchema: z.ZodObject<{
    type: z.ZodEnum<["npm", "git", "local"]>;
    location: z.ZodString;
}, "strip", z.ZodTypeAny, {
    type: "npm" | "git" | "local";
    location: string;
}, {
    type: "npm" | "git" | "local";
    location: string;
}>;
export type Source = z.infer<typeof SourceSchema>;
export declare const MetadataSchema: z.ZodOptional<z.ZodObject<{
    author: z.ZodOptional<z.ZodString>;
    license: z.ZodOptional<z.ZodString>;
    homepage: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    author?: string | undefined;
    license?: string | undefined;
    homepage?: string | undefined;
}, {
    author?: string | undefined;
    license?: string | undefined;
    homepage?: string | undefined;
}>>;
export type Metadata = z.infer<typeof MetadataSchema>;
export declare const ServerManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    version: z.ZodString;
    source: z.ZodObject<{
        type: z.ZodEnum<["npm", "git", "local"]>;
        location: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "npm" | "git" | "local";
        location: string;
    }, {
        type: "npm" | "git" | "local";
        location: string;
    }>;
    checksum: z.ZodString;
    tools: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        description: string;
        id: string;
        name: string;
    }, {
        description: string;
        id: string;
        name: string;
    }>, "many">;
    capabilities: z.ZodArray<z.ZodObject<{
        tool_id: z.ZodString;
        verb: z.ZodEnum<["read", "fetch", "send", "write", "delete", "execute"]>;
        resource: z.ZodOptional<z.ZodString>;
        provenance: z.ZodEnum<["declared", "inferred"]>;
        description: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        tool_id: string;
        verb: "read" | "fetch" | "send" | "write" | "delete" | "execute";
        provenance: "declared" | "inferred";
        resource?: string | undefined;
        description?: string | undefined;
    }, {
        tool_id: string;
        verb: "read" | "fetch" | "send" | "write" | "delete" | "execute";
        provenance: "declared" | "inferred";
        resource?: string | undefined;
        description?: string | undefined;
    }>, "many">;
    secrets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        required: z.ZodBoolean;
        used_by: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        description: string;
        id: string;
        required: boolean;
        used_by: string[];
    }, {
        description: string;
        id: string;
        required: boolean;
        used_by: string[];
    }>, "many">;
    metadata: z.ZodOptional<z.ZodObject<{
        author: z.ZodOptional<z.ZodString>;
        license: z.ZodOptional<z.ZodString>;
        homepage: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        author?: string | undefined;
        license?: string | undefined;
        homepage?: string | undefined;
    }, {
        author?: string | undefined;
        license?: string | undefined;
        homepage?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    schemaVersion: 1;
    version: string;
    source: {
        type: "npm" | "git" | "local";
        location: string;
    };
    checksum: string;
    tools: {
        description: string;
        id: string;
        name: string;
    }[];
    capabilities: {
        tool_id: string;
        verb: "read" | "fetch" | "send" | "write" | "delete" | "execute";
        provenance: "declared" | "inferred";
        resource?: string | undefined;
        description?: string | undefined;
    }[];
    secrets: {
        description: string;
        id: string;
        required: boolean;
        used_by: string[];
    }[];
    metadata?: {
        author?: string | undefined;
        license?: string | undefined;
        homepage?: string | undefined;
    } | undefined;
}, {
    schemaVersion: 1;
    version: string;
    source: {
        type: "npm" | "git" | "local";
        location: string;
    };
    checksum: string;
    tools: {
        description: string;
        id: string;
        name: string;
    }[];
    capabilities: {
        tool_id: string;
        verb: "read" | "fetch" | "send" | "write" | "delete" | "execute";
        provenance: "declared" | "inferred";
        resource?: string | undefined;
        description?: string | undefined;
    }[];
    secrets: {
        description: string;
        id: string;
        required: boolean;
        used_by: string[];
    }[];
    metadata?: {
        author?: string | undefined;
        license?: string | undefined;
        homepage?: string | undefined;
    } | undefined;
}>;
export type ServerManifest = z.infer<typeof ServerManifestSchema>;
export type ValidationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    errors: ValidationError[];
};
export interface ValidationError {
    path: (string | number)[];
    message: string;
    code: string;
}
/**
 * Parse and validate a server manifest from JSON.
 * Returns detailed, human-readable errors on failure.
 */
export declare function parseManifest(input: unknown): ValidationResult<ServerManifest>;
/**
 * Validate a manifest instance. Useful after round-trip deserialization.
 */
export declare function validateManifest(manifest: unknown): ValidationResult<ServerManifest>;
/**
 * Type guard: is this a valid ServerManifest?
 */
export declare function isServerManifest(value: unknown): value is ServerManifest;
//# sourceMappingURL=schema.d.ts.map