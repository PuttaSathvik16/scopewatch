export type LifecycleState = 'discovered' | 'reviewed' | 'installed' | 'configured' | 'validated' | 'active' | 'disabled' | 'removed';
export type EventType = 'transition_intent' | 'transition_confirmed' | 'transition_failed' | 'recovery' | 'rollback';
export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export type ManifestRow = {
    id: number;
    server_id: string;
    version: string;
    source_type: 'npm' | 'git' | 'local';
    source_location: string;
    checksum: string;
    manifest_json: string;
    inserted_at: number;
};
export type LockfileEntryRow = {
    id: number;
    server_id: string;
    client_id: string;
    manifest_id: number;
    state: LifecycleState;
    last_diff_id: number | null;
    activated_at: number | null;
    updated_at: number;
};
export type CapabilityDiffRow = {
    id: number;
    from_manifest_id: number;
    to_manifest_id: number;
    diff_json: string;
    newly_destructive: 0 | 1;
    risk_level: RiskLevel;
    rendered_summary: string | null;
    created_at: number;
};
export type RollbackCheckpointRow = {
    id: number;
    server_id: string;
    client_id: string;
    manifest_id: number;
    state_at_checkpoint: LifecycleState;
    checkpoint_json: string;
    created_at: number;
    restored_at: number | null;
};
export type LifecycleEventRow = {
    id: number;
    server_id: string;
    client_id: string;
    diff_id: number | null;
    from_state: LifecycleState;
    to_state: LifecycleState;
    event_type: EventType;
    resolves_intent_id: number | null;
    pending_side_effects: string | null;
    error_message: string | null;
    checkpoint_id: number | null;
    created_at: number;
};
export type Intent = LifecycleEventRow;
//# sourceMappingURL=types.d.ts.map