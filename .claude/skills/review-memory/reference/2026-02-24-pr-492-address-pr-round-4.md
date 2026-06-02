# PR-492 address-pr run 4

- Truncation helpers that append an ellipsis must reserve suffix width (`maxLength - 3` for `'...'`) so the final output never exceeds the configured maximum.
- Authentication error classifiers should only match explicit auth-required signals (for example `not authenticated`, `please run /login`, `authentication required`) and avoid generic keywords like `authentication` that can misclassify transient failures.
