---
date: 2026-06-19
source: pull-request-review
scope: review-workflow
---

# Partial Result Duration Sanitization

- Treat sandbox `partialResult` fields as untrusted data before persisting failed or stopped agent runs.
- Clamp optional duration values to finite non-negative numbers, matching the existing token count sanitization pattern.
