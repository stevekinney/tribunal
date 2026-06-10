/**
 * Workflow and activity registries for the in-process engine.
 *
 * Left as bare object literals (no `Record<...>` annotation) on purpose: that
 * lets `Engine.create` infer the branded default workflow registry. Annotating
 * with an index signature erases the brand and breaks engine start typing
 * (see https://github.com/stevekinney/weft/issues/455).
 *
 * Empty for now — the engine boots and recovers cleanly with no registered
 * types. Ported workflows land here as Tribunal restores its automation (see
 * documentation/WEFT_MIGRATION_PLAN.md §5):
 *   - pull-request-orchestrator  (coalesces webhook events per PR; sliding debounce)
 *   - installation-sync          (start-or-signal per installation)
 *
 * Author-side Weft gaps to apply once they ship upstream:
 *   - ctx.log structured logger:        https://github.com/stevekinney/weft/issues/447
 *   - resumable activity heartbeats:    https://github.com/stevekinney/weft/issues/450
 *   - ctx.workflowType on context:      https://github.com/stevekinney/weft/issues/451
 */
export const workflows = {};
export const activities = {};
