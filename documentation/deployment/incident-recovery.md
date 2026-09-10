# Incident Recovery

This document is the recovery runbook for a failed `Deploy Production` run (`.github/workflows/deploy-production.yml`). Use `documentation/deployment/containers.md` for the deploy procedure itself; use this document once that procedure has already failed in production. See TRI-125 for the incident (2026-09-09/10, ~4 hours of `tribunal-web` downtime) that motivated it.

## How you find out

A failed `Deploy Production` run opens a GitHub issue automatically (the `notify-on-failure` job). It keys off the `deploy` job's conclusion—`failure` or `cancelled`, which includes the 45-minute job timeout—not any individual step, so it fires whether the failure happened early (for example at the `Deploy web` step) or late (for example at `Verify public health checks`). If a retried deploy for the same commit fails again, the job comments on the existing open issue instead of opening a duplicate.

## First: confirm whether this is still an outage, and which commit is live

`deployment/fly/web.toml` sets `min_machines_running = 1` and `strategy = "bluegreen"` (TRI-125). With those in place, a failed web deploy destroys the new, unhealthy Machine and leaves whatever Machine was already running in place—so the failed deploy should usually show up as a red GitHub Actions run, not a 502. But a green `/health` does not by itself tell you _which_ commit answered it: the `deploy` job can also fail on a step _after_ the web Machine already cut over successfully (the load gate, the unauthorized-proxy check, the deliberately-failed stale-reviewer step), in which case the new commit is what's serving, not the previous one. Check both:

```sh
flyctl machines list --app tribunal-web --json | jq -r '.[] | select(.state=="started") | .image_ref.labels.GH_SHA'
curl -fsS https://<web-domain>/health
```

Compare the `GH_SHA` label against the commit the failed workflow run attempted to deploy (`DEPLOY_SHA` in the incident issue). If a Machine is `started`, `/health` returns `200`, and `GH_SHA` is the _previous_ known-good commit, the site is up on the old version; the deploy failure still needs to be root-caused and fixed, but there is no active outage to stop the bleeding on. If `GH_SHA` matches the _failed_ commit, the new version did boot and is serving despite the job failing elsewhere—treat that as a lower-severity "deploy job failed after web went live" incident, not an outage, but still root-cause why the job failed. If no Machine is `started` or `/health` is failing, continue below.

## Recovery when the failed commit is behind `main`

Re-running the failed `Deploy Production` workflow run does not work once `main` has advanced: the `Verify deploy commit is current main` step deliberately refuses to deploy a commit that is no longer `origin/main`'s tip. That guard exists because deploying a stale commit is its own hazard (see `.claude/rules/deployment-configuration.md`); it also means "just re-run it" stops being an option as soon as anything else merges.

Restore service by redeploying the last known-good image directly through Fly, bypassing GitHub Actions (and therefore the currency guard) entirely. This targets Fly's own release history, so it does not depend on git state at all:

```sh
gh run list --repo stevekinney/tribunal --workflow deploy-production.yml --status success --limit 5 --json databaseId,headSha,updatedAt
```

A workflow run can conclude `success` with the `deploy` job itself skipped (for example a `workflow_dispatch` run against a non-`main` ref, or a `workflow_run` trigger whose upstream CI failed), so `--status success` alone does not prove a deploy happened. Starting from the most recent row, confirm the `deploy` job actually ran and succeeded before trusting a run:

```sh
gh run view <databaseId> --repo stevekinney/tribunal --json jobs --jq '.jobs[] | select(.name == "Deploy Production") | .conclusion'
```

Move to the next-older row if that prints anything other than `success`. Once you have a confirmed run, note its `updatedAt` (the run's completion time, not `createdAt`—Fly creates the release near completion, so filtering by `createdAt` can exclude the very release that run produced) and `headSha` (the commit you are trying to get back to):

```sh
flyctl releases --image --app tribunal-web --json
```

From the `flyctl releases` output, find the most recent release with `"Status": "complete"` whose `CreatedAt` is at or before the confirmed run's `updatedAt` (a release with any other status, or one created after that run finished, is not a safe target), and copy its `ImageRef` (for example `registry.fly.io/tribunal-web:deployment-01ABCDEFGHJKMNPQRSTVWXYZ`), then:

```sh
flyctl deploy --image <image-ref> --config deployment/fly/web.toml --app tribunal-web
flyctl scale count 1 --yes --app tribunal-web
```

Re-run the health gates in `documentation/deployment/containers.md` afterward, including the `GH_SHA` check above, to confirm the redeployed image is actually the commit you intended.

Do the same for `tribunal-engine` or `tribunal-proxy` if the incident involves those services, substituting `--config deployment/fly/engine.toml` or `--config deployment/fly/proxy.toml` and the matching `--app`.

> [!WARNING]
> `flyctl releases rollback` is not a valid `flyctl` subcommand on the Machines platform this project uses (verified against the installed `flyctl`—`flyctl releases rollback --help` silently falls back to `flyctl releases --help` and exits `0`, rather than erroring on an unknown subcommand). Use `flyctl deploy --image <ref>` as shown above instead.

This is an out-of-band fix, not a durable one: the next successful merge to `main` triggers `Deploy Production` again and redeploys whatever is on `main` at that point, which supersedes this recovery deploy. It stops the outage; it does not fix the underlying defect. Land and merge the actual fix through the normal pull request lifecycle so the next automatic deploy succeeds instead of reintroducing the same failure.

## After recovery

Confirm health gates pass (`documentation/deployment/containers.md` "Health Gates"), including that `GH_SHA` on the running Machine matches the image you intended to restore. Then root-cause the original deploy failure and open or update the corresponding Linear issue. Land the fix through the normal pull request lifecycle rather than leaving the manually deployed image as the permanent state. Close the incident GitHub issue once `main` has redeployed cleanly through `Deploy Production`.
