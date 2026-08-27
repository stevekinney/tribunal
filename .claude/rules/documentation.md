---
paths:
  - documentation/**
---

# Documentation conventions

- Update `documentation/API.md` when adding or changing API endpoints so the endpoint tables stay current.
- For CLI docs (tables and quick-starts), keep flags in sync with the actual implementation; remove options from docs when the flag is removed in code.
- Verify every documented file path and import symbol against the current tree before merging. Do not document non-existent modules or wrong export locations.
- Keep pull request descriptions aligned with the actual diff scope. If implementation scope changes, update title/body before merge.
- For SQL snippets, verify schema/table/column names against current migrations before publishing examples.
- Avoid line-number references in docs unless generated links stay valid across file churn.
- **Run a documented command before publishing it, including its failure mode.** `git clone URL && git checkout SHA` exits 128 because `git clone` does not change the working directory — a check performed correctly with `git -C` and then written down in a form that cannot pass. A verification command that cannot succeed is worse than none, because a reader takes its failure as a real result.
- **When correcting a claim, sweep for the subject rather than your own wording.** Grepping the phrase you just wrote finds only the sites you already knew about. A correction to gate ownership in this repository came back clean against `gates 1 and 4` while the sentence that actually mattered read "Checks 1, 2, and 4 belong to whichever issue implements the flag" — same fact, no shared phrase, and it took three review rounds to find. Search for the thing being described, across every document, and into the tracker: a corrected document that disagrees with an issue body has moved the defect rather than fixed it. Where the two can disagree, state which one wins.
