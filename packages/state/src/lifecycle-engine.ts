import type { SqliteDatabase } from './db.js';
import type { LifecycleState, LifecycleEventRow, Intent } from './types.js';

const now = () => Math.floor(Date.now() / 1000);

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
export class LifecycleEngine {
  private db: SqliteDatabase;
  private recovered = false;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /** Idempotent recovery guard. Synchronous, so no race window exists. */
  private ensureRecovered(): void {
    if (this.recovered) return;
    this.onStartup();
    this.recovered = true;
  }

  /**
   * Run recovery: find any unresolved transition_intent per (server_id, client_id)
   * and resolve it deterministically - restore from checkpoint if one exists,
   * otherwise just record the abandoned attempt (lockfile_entries was never touched
   * for a transition with no checkpoint, since checkpoint + intent are written
   * atomically together).
   */
  onStartup(): void {
    // Must scan lifecycle_events, not lockfile_entries: a crash during a pair's very
    // FIRST transition (before any confirmTransition ever ran) means lockfile_entries
    // has no row for that pair yet, even though an unresolved intent exists.
    const pairs = this.db
      .prepare('SELECT DISTINCT server_id, client_id FROM lifecycle_events')
      .all() as { server_id: string; client_id: string }[];

    for (const { server_id, client_id } of pairs) {
      const unresolved = this.getUnresolvedIntentInternal(server_id, client_id);
      if (!unresolved) continue;

      if (unresolved.checkpoint_id) {
        const restore = this.db.transaction(() => {
          this.recoveryRestoreInternal(server_id, client_id, unresolved.checkpoint_id!);

          const checkpoint = this.db
            .prepare('SELECT * FROM rollback_checkpoints WHERE id = ?')
            .get(unresolved.checkpoint_id) as { state_at_checkpoint: LifecycleState };

          this.db
            .prepare(
              `INSERT INTO lifecycle_events
                (server_id, client_id, from_state, to_state, event_type, resolves_intent_id, checkpoint_id, created_at)
               VALUES (?, ?, ?, ?, 'recovery', ?, ?, ?)`
            )
            .run(
              server_id,
              client_id,
              unresolved.to_state,
              checkpoint.state_at_checkpoint,
              unresolved.id,
              unresolved.checkpoint_id,
              now()
            );
        });
        restore();
      } else {
        // No checkpoint: this transition never touched lockfile_entries (checkpoint
        // and intent are written atomically together only for away-from-active moves).
        // Nothing to restore; just record the abandoned attempt.
        this.db
          .prepare(
            `INSERT INTO lifecycle_events
              (server_id, client_id, from_state, to_state, event_type, resolves_intent_id, created_at)
             VALUES (?, ?, ?, ?, 'recovery', ?, ?)`
          )
          .run(server_id, client_id, unresolved.from_state, unresolved.from_state, unresolved.id, now());
      }
    }
  }

  /** Internal, unguarded - only ever called from onStartup() itself. */
  private getUnresolvedIntentInternal(server_id: string, client_id: string): Intent | null {
    const intent = this.db
      .prepare(
        `SELECT * FROM lifecycle_events
         WHERE server_id = ? AND client_id = ? AND event_type = 'transition_intent'
         ORDER BY id DESC LIMIT 1`
      )
      .get(server_id, client_id) as LifecycleEventRow | undefined;

    if (!intent) return null;

    const resolution = this.db
      .prepare('SELECT id FROM lifecycle_events WHERE resolves_intent_id = ? LIMIT 1')
      .get(intent.id);

    return resolution ? null : intent;
  }

  /** Public, guarded - safe for any external caller. */
  getUnresolvedIntent(server_id: string, client_id: string): Intent | null {
    this.ensureRecovered();
    return this.getUnresolvedIntentInternal(server_id, client_id);
  }

  /**
   * Start a transition. Enforces the single-unresolved-intent invariant: throws if
   * a prior transition for this (server_id, client_id) pair is still unresolved.
   * If from_state === 'active', atomically captures a rollback checkpoint of the
   * current lockfile row before writing the intent.
   * Returns the intent's row id, to be passed to confirmTransition/failTransition.
   */
  startTransition(
    server_id: string,
    client_id: string,
    from_state: LifecycleState,
    to_state: LifecycleState,
    diff_id: number | null,
    pending_side_effects: string[] = []
  ): number {
    this.ensureRecovered();

    const existing = this.getUnresolvedIntent(server_id, client_id);
    if (existing) {
      throw new Error(
        `Transition already in progress for ${server_id} on ${client_id} ` +
          `(intent id ${existing.id}, ${existing.from_state} -> ${existing.to_state}). ` +
          `Resolve or recover it before starting a new transition.`
      );
    }

    const run = this.db.transaction(() => {
      let checkpoint_id: number | null = null;

      if (from_state === 'active') {
        const current = this.db
          .prepare('SELECT manifest_id, state FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
          .get(server_id, client_id) as { manifest_id: number; state: LifecycleState } | undefined;

        if (current) {
          const result = this.db
            .prepare(
              `INSERT INTO rollback_checkpoints
                (server_id, client_id, manifest_id, state_at_checkpoint, checkpoint_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(server_id, client_id, current.manifest_id, current.state, JSON.stringify(current), now());
          checkpoint_id = Number(result.lastInsertRowid);
        }
      }

      const result = this.db
        .prepare(
          `INSERT INTO lifecycle_events
            (server_id, client_id, from_state, to_state, event_type, diff_id, pending_side_effects, checkpoint_id, created_at)
           VALUES (?, ?, ?, ?, 'transition_intent', ?, ?, ?, ?)`
        )
        .run(
          server_id,
          client_id,
          from_state,
          to_state,
          diff_id,
          pending_side_effects.length > 0 ? JSON.stringify(pending_side_effects) : null,
          checkpoint_id,
          now()
        );

      return Number(result.lastInsertRowid);
    });

    return run();
  }

  /**
   * Resolve an intent successfully: atomically write transition_confirmed
   * (correlated via resolves_intent_id) and update lockfile_entries (upsert).
   */
  confirmTransition(intent_id: number, manifest_id?: number): void {
    this.ensureRecovered();

    const intent = this.db
      .prepare('SELECT * FROM lifecycle_events WHERE id = ?')
      .get(intent_id) as LifecycleEventRow | undefined;
    if (!intent) throw new Error(`No such intent: ${intent_id}`);

    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO lifecycle_events
            (server_id, client_id, from_state, to_state, event_type, resolves_intent_id, diff_id, created_at)
           VALUES (?, ?, ?, ?, 'transition_confirmed', ?, ?, ?)`
        )
        .run(intent.server_id, intent.client_id, intent.from_state, intent.to_state, intent_id, intent.diff_id, now());

      const effectiveManifestId = manifest_id ?? this.currentManifestId(intent.server_id, intent.client_id);

      this.db
        .prepare(
          `INSERT INTO lockfile_entries (server_id, client_id, manifest_id, state, last_diff_id, activated_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, client_id) DO UPDATE SET
             manifest_id = excluded.manifest_id,
             state = excluded.state,
             last_diff_id = excluded.last_diff_id,
             activated_at = CASE WHEN excluded.state = 'active' THEN excluded.updated_at ELSE lockfile_entries.activated_at END,
             updated_at = excluded.updated_at`
        )
        .run(
          intent.server_id,
          intent.client_id,
          effectiveManifestId,
          intent.to_state,
          intent.diff_id,
          intent.to_state === 'active' ? now() : null,
          now()
        );
    });

    run();
  }

  /** Resolve an intent as failed. Does NOT change lockfile_entries; from_state stands. */
  failTransition(intent_id: number, error: Error): void {
    this.ensureRecovered();

    const intent = this.db
      .prepare('SELECT * FROM lifecycle_events WHERE id = ?')
      .get(intent_id) as LifecycleEventRow | undefined;
    if (!intent) throw new Error(`No such intent: ${intent_id}`);

    this.db
      .prepare(
        `INSERT INTO lifecycle_events
          (server_id, client_id, from_state, to_state, event_type, resolves_intent_id, error_message, created_at)
         VALUES (?, ?, ?, ?, 'transition_failed', ?, ?, ?)`
      )
      .run(intent.server_id, intent.client_id, intent.from_state, intent.to_state, intent_id, error.message, now());
  }

  private currentManifestId(server_id: string, client_id: string): number {
    const row = this.db
      .prepare('SELECT manifest_id FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
      .get(server_id, client_id) as { manifest_id: number } | undefined;
    if (!row) throw new Error(`No lockfile entry for ${server_id}/${client_id}; manifest_id must be supplied`);
    return row.manifest_id;
  }

  /** Shared restore logic. Internal, no guard - callers must already hold ensureRecovered(). */
  private recoveryRestoreInternal(server_id: string, client_id: string, checkpoint_id: number): void {
    const checkpoint = this.db
      .prepare('SELECT * FROM rollback_checkpoints WHERE id = ?')
      .get(checkpoint_id) as { manifest_id: number; state_at_checkpoint: LifecycleState } | undefined;
    if (!checkpoint) throw new Error(`No such checkpoint: ${checkpoint_id}`);

    this.db
      .prepare(
        `UPDATE lockfile_entries SET state = ?, manifest_id = ?, updated_at = ?
         WHERE server_id = ? AND client_id = ?`
      )
      .run(checkpoint.state_at_checkpoint, checkpoint.manifest_id, now(), server_id, client_id);

    this.db.prepare('UPDATE rollback_checkpoints SET restored_at = ? WHERE id = ?').run(now(), checkpoint_id);
  }

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
  rollback(server_id: string, client_id: string): void {
    this.ensureRecovered();

    const unresolved = this.getUnresolvedIntent(server_id, client_id);
    if (unresolved) {
      throw new Error(
        `Cannot rollback ${server_id} on ${client_id}: a transition is still unresolved ` +
          `(intent id ${unresolved.id}). Recover it first.`
      );
    }

    const checkpoint = this.db
      .prepare(
        `SELECT * FROM rollback_checkpoints WHERE server_id = ? AND client_id = ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(server_id, client_id) as { id: number; state_at_checkpoint: LifecycleState } | undefined;

    if (!checkpoint) {
      throw new Error(`No checkpoint available to roll back to for ${server_id} on ${client_id}`);
    }

    const run = this.db.transaction(() => {
      this.recoveryRestoreInternal(server_id, client_id, checkpoint.id);

      this.db
        .prepare(
          `INSERT INTO lifecycle_events
            (server_id, client_id, from_state, to_state, event_type, checkpoint_id, created_at)
           VALUES (?, ?, 'active', ?, 'rollback', ?, ?)`
        )
        .run(server_id, client_id, checkpoint.state_at_checkpoint, checkpoint.id, now());
    });

    run();
  }

  /** Current lockfile state for a (server_id, client_id) pair, or null if none exists. */
  getState(server_id: string, client_id: string): LifecycleState | null {
    this.ensureRecovered();
    const row = this.db
      .prepare('SELECT state FROM lockfile_entries WHERE server_id = ? AND client_id = ?')
      .get(server_id, client_id) as { state: LifecycleState } | undefined;
    return row?.state ?? null;
  }

  /** All lifecycle events for a pair, oldest first - the full audit trail. */
  getEvents(server_id: string, client_id: string): LifecycleEventRow[] {
    this.ensureRecovered();
    return this.db
      .prepare('SELECT * FROM lifecycle_events WHERE server_id = ? AND client_id = ? ORDER BY id ASC')
      .all(server_id, client_id) as LifecycleEventRow[];
  }
}
