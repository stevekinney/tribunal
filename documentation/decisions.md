# Tribunal Review Engine Decisions

## 2026-06-17 Foundation Dependency Pins

- `@lostgradient/weft`: `0.6.0` from npm and already present in the existing web app.
- `tensorlake`: `0.5.47` from npm.
- `@anthropic-ai/claude-agent-sdk`: `0.3.181` from npm.

The foundation workspaces pin the runtime review-engine dependencies exactly where they are introduced. Later tracks should update this file before changing any of these versions.
