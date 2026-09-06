import type { SqliteDatabase } from './db.js';
import type { LifecycleState, LifecycleEventRow, Intent } from './types.js';
/**
 * LifecycleEngine drives every state transition for a (server_id, client_id) pair.
 *
 * Design notes (locked, see CLAUDE.md Phase C):
 * - better-sqlite3 is synchronous. All DB operations here are synchronous. This is
 *   deliberate: it eliminates the race-condition window that an async recovery guard
 *   would otherwise need to defend against (no `await` point exists for two calls to
 *   interleave in). When Phase D/F adds real async external side effects (writing a
 *   client config file, calling the OS keychain), those side effects happen OUTSIDE
 *   the synchronous DB transaction, between startTransition() and confirmTransition().
 * - Every transition follows write-ahead-intent: startTransition() records intent
 *   (and, if leaving 'active', a checkpoint) atomically; the caller performs any
 *   side effects; then confirmTransition() or failTransition() resolves the intent,
 *   atomically with any lockfile_entries update.
 * - lockfile_entries is UPSERT-ONLY: exactly one row per (server_id, client_id).
 * - Recovery (onStartup) is self-enforcing via ensureRecovered(), called at the top
 *   of every public method. onStartup() itself must never call back into a guarded
 *   public method - it uses the internal/unguarded variant to avoid infinite recursion.
 */
export declare class LifecycleEngine {
    private db;
    private recovered;
    constructor(db: SqliteDatabase);
    /** Idempotent recovery guard. Synchronous, so no race window exists. */
    private ensureRecovered;
    /**
     * Run recovery: find any unresolved transition_intent per (server_id, client_id)
     * and resolve it deterministically - restore from checkpoint if one exists,
     * otherwise just record the abandoned attempt (lockfile_entries was never touched
     * for a transition with no checkpoint, since checkpoint + intent are written
     * atomically together).
     */
    onStartup(): void;
    /** Internal, unguarded - only ever called from onStartup() itself. */
    private getUnresolvedIntentInternal;
    /** Public, guarded - safe for any external caller. */
    getUnresolvedIntent(server_id: string, client_id: string): Intent | null;
    /**
     * Start a transition. Enforces the single-unresolved-intent invariant: throws if
     * a prior transition for this (server_id, client_id) pair is still unresolved.
     * If from_state === 'active', atomically captures a rollback checkpoint of the
     * current lockfile row before writing the intent.
     * Returns the intent's row id, to be passed to confirmTransition/failTransition.
     */
    startTransition(server_id: string, client_id: string, from_state: LifecycleState, to_state: LifecycleState, diff_id: number | null, pending_side_effects?: string[]): number;
    /**
     * Resolve an intent successfully: atomically write transition_confirmed
     * (correlated via resolves_intent_id) and update lockfile_entries (upsert).
     */
    confirmTransition(intent_id: number, manifest_id?: number): void;
    /** Resolve an intent as failed. Does NOT change lockfile_entries; from_state stands. */
    failTransition(intent_id: number, error: Error): void;
    private currentManifestId;
    /** Shared restore logic. Internal, no guard - callers must already hold ensureRecovered(). */
    private recoveryRestoreInternal;
    /**
     * Explicit user-initiated rollback to the most recent checkpoint for this pair.
     * Refuses if a transition is currently unresolved (invariant check).
     *
     * TODO (Phase D/F): once rollback involves external side effects (reverting a
     * client config file, restoring a secret), this must follow the same
     * intent/confirm/transaction pattern as startTransition/confirmTransition.
     * It is safe to do a pure DB operation here ONLY because Phase C has no external
     * side effects to roll back - do not carry this shortcut forward unexamined.
     */
    rollback(server_id: string, client_id: string): void;
    /** Current lockfile state for a (server_id, client_id) pair, or null if none exists. */
    getState(server_id: string, client_id: string): LifecycleState | null;
    /** All lifecycle events for a pair, oldest first - the full audit trail. */
    getEvents(server_id: string, client_id: string): LifecycleEventRow[];
}
//# sourceMappingURL=lifecycle-engine.d.ts.map