import { readFile } from 'node:fs/promises';

const [, , agentSlug] = process.argv;

if (!agentSlug) {
  console.error('Missing agent slug.');
  process.exit(1);
}

if (!process.env.TRIBUNAL_RUN_TOKEN) {
  console.error('Missing TRIBUNAL_RUN_TOKEN.');
  process.exit(1);
}

const resultPath = process.env.TRIBUNAL_AGENT_RESULT_FILE;

if (resultPath) {
  process.stdout.write(await readFile(resultPath, 'utf8'));
} else {
  process.stdout.write(
    JSON.stringify({
      agentSlug,
      findings: [],
      modelUsed: process.env.TRIBUNAL_AGENT_MODEL ?? 'unknown',
      effortUsed: process.env.TRIBUNAL_AGENT_EFFORT ?? null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      costEstimateUsd: 0,
      durationMs: 0,
    }),
  );
}
