## Summary

## Test Plan

## Out-of-band human step (if any)

- [ ] This PR's completion does not depend on a manual step outside CI, or a blocking Linear issue exists in the owning team with binary evidence criteria (an authenticated endpoint response, a registry query, a deployment status — never this PR's merge, never a checked box here).

---

### Database Migration Checklist

If this PR includes schema changes (`packages/database/drizzle/` or `packages/database/src/schema/`):

- [ ] Migration follows patterns in `packages/database/MIGRATIONS.md`
- [ ] Idempotency verified (safe to run multiple times)
- [ ] Backward compatibility confirmed (N-1 app version works)
- [ ] CI migration job passes (the `migration` job in `.github/workflows/ci.yml`)
- [ ] Large table operations use `CONCURRENTLY` or batched updates
- [ ] Multi-phase migrations documented in PR description
