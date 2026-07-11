# Engine Startup Control Ownership

- Binding a health listener proves process liveness, not singleton ownership or readiness to accept control work.
- Authenticate control requests during startup even when the runtime is not ready; authentication and ownership are separate gates.
- Do not acknowledge asynchronous control requests until the process can guarantee the work will run or has durably handed it off.
- When only the runtime owner can drain a durable queue, a retryable startup response is safer than a successful no-op acknowledgement.
