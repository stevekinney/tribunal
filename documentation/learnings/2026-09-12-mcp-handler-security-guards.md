# MCP handler security guards

[Pull request #382](https://github.com/stevekinney/tribunal/pull/382) added TRI-54's credential, outbound-call, and subscription authorization guards. Its review exposed ways a passing security test can miss the behavior it claims to constrain.

- A handler can capture `globalThis.fetch` while its module loads. Install the interception boundary before importing the registry so captured references remain observable.
- One sample input only reaches one set of branches. Keep a source guard alongside runtime invocations to catch direct fetches on paths the samples do not take. Reader modules remain the authorized database and cached-client boundary.
- A raw subscription request does not prove modern-client authorization. Drive both denial and scoped success through `Client.listen`, which supplies the modern negotiation envelope.
- A fixed fetch-client blacklist misses other implementations. Allow only reviewed external runtime imports and fail when a new package enters the handler graph.
- Callable context capabilities can carry credentials in their own properties. Traverse functions as well as objects, checking both property names and values.
- Platform capabilities such as `AbortSignal` can also carry custom properties. Exclude only native internal symbols, and cover custom string and symbol keys. Pin the fixture to the test environment when disabling Redis so production backstops remain separate from these mounted tests.

The registry also contains resource handlers. Include them alongside tools, and require explicit coverage before a prompt can be registered. For every refusal test, close an unexpectedly successful stream in `finally`; otherwise the negative control can hang instead of reporting its failed assertion.

These rules are recorded in the [testing guide](../TESTING.md#mcp-security-guards). Verify with `bun run test:mcp:passthrough` and record the temporary violations and observed failures in the pull request.
