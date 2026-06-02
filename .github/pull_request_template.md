## Summary

## Test Plan

---

### Database Migration Checklist

If this PR includes schema changes (`packages/database/drizzle/` or `packages/database/src/schema/`):

- [ ] Migration follows patterns in `packages/database/MIGRATIONS.md`
- [ ] Idempotency verified (safe to run multiple times)
- [ ] Backward compatibility confirmed (N-1 app version works)
- [ ] CI migration job passes (the `migration` job in `.github/workflows/ci.yml`)
- [ ] Large table operations use `CONCURRENTLY` or batched updates
- [ ] Multi-phase migrations documented in PR description
