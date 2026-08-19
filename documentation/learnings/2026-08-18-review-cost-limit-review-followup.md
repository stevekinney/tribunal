# Review Cost Limit Review Follow-Up

- Browser consumers of a mixed runtime package must import a browser-safe subpath rather than its root barrel when that barrel exports Node-only modules.
- A standalone workspace test configuration that imports a sibling package must resolve the needed source entrypoint explicitly when its normal package export targets build output.
