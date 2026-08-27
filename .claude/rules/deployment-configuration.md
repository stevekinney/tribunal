---
paths:
  - deployment/**
  - scripts/deploy.ts
---

# Deployment configuration rules

These govern the committed values that deploys reapply, separately from `github-actions.md`, which governs workflow authoring. An operator changing a deployed value is usually editing a TOML file or the deploy script rather than a workflow.

## Durability

- **A configuration change is not durable while automation redeploys the committed state.** `deploy-production.yml` redeploys on every successful push to `main`, so an out-of-band or local change to a deployed value is reversed by the next unrelated merge, with nothing announcing the expiry.
- A durable change therefore requires the committed state to agree with it. An out-of-band override is only the first half: apply it to stop the bleeding, then land the committed change so the automation reinforces the decision instead of reversing it.
- Before choosing that path, establish which failure you have. **Is the value failing to be applied, or failing to cover?** The two-step procedure fixes the first. The second is a code problem no configuration value solves, and committing an inert flag simply redeploys the broken build behind it.

## Flag enforcement

- A flag is enforced where the privileged thing is acquired, not at the outer loop that looks like the entry point. `REVIEWS_ENABLED` is the worked example: the scheduler still runs its drain loop when the flag is false, and the effective gate is `claimNextReviewIntent` returning `null`.
- Check whether a flag is parsed in more than one place. `REVIEWS_ENABLED` is read independently by `applications/engine/src/index.ts` and by `createReviewIntentConsumer`, which is a drift hazard rather than a pattern to copy.

## Shared secrets

- Some secrets are shared across applications rather than owned by one. `ENCRYPTION_KEY` is used by web, engine, and proxy; `PROXY_SIGNING_KEY` is signed with by the engine and verified by the proxy. Provisioning and rotation for these are multi-application operations — rotating one service independently breaks the others.
