import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { eq } from '../../operators';
import {
  agent,
  agentEvent,
  agentRun,
  costEvent,
  finding,
  repository,
  repositoryAgent,
  tribunalRun,
  user,
} from '../index';

describe('agent deletion history preservation', () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  }, 30_000);

  afterAll(async () => {
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.reset();
  });

  it('preserves run history while removing future repository assignments', async () => {
    const [owner] = await testDatabase.db
      .insert(user)
      .values({ username: 'owner-user' })
      .returning();
    await testDatabase.db.insert(repository).values({
      id: 9001,
      owner: 'lost-gradient',
      name: 'tribunal',
      uri: 'https://github.com/lost-gradient/tribunal.git',
      defaultBranch: 'main',
    });
    await testDatabase.db.insert(agent).values({
      id: 'agent_security',
      userId: owner.id,
      slug: 'security',
      description: 'Finds security issues',
      body: 'Review for security issues.',
      model: 'sonnet',
      enabled: true,
    });
    await testDatabase.db.insert(repositoryAgent).values({
      userId: owner.id,
      repositoryId: 9001,
      agentId: 'agent_security',
    });
    await testDatabase.db.insert(tribunalRun).values({
      id: 'run_1',
      userId: owner.id,
      repositoryId: 9001,
      runKind: 'pull_request_review',
      status: 'posted',
    });
    await testDatabase.db.insert(agentRun).values({
      id: 'agent_run_1',
      userId: owner.id,
      runId: 'run_1',
      agentId: 'agent_security',
      agentSlug: 'security',
      agentDescription: 'Finds security issues',
      status: 'succeeded',
      findingsCount: 1,
    });
    await testDatabase.db.insert(finding).values({
      id: 'finding_1',
      userId: owner.id,
      agentRunId: 'agent_run_1',
      path: 'src/unsafe.ts',
      startLine: 10,
      endLine: null,
      side: 'RIGHT',
      severity: 'warning',
      title: 'Unsafe call',
      body: 'The run history should keep this finding.',
      anchored: true,
      fingerprint: 'fingerprint_1',
    });
    await testDatabase.db.insert(agentEvent).values({
      agentRunId: 'agent_run_1',
      seq: 1,
      kind: 'message',
      detail: { text: 'historical event' },
    });
    await testDatabase.db.insert(costEvent).values({
      id: 'cost_1',
      userId: owner.id,
      kind: 'llm',
      repositoryId: 9001,
      reviewRunId: 'run_1',
      agentRunId: 'agent_run_1',
      agentId: 'agent_security',
      amountUsd: '0.01',
      idempotencyKey: 'cost_1',
    });

    await testDatabase.db.delete(agent).where(eq(agent.id, 'agent_security'));

    await expect(testDatabase.db.select().from(repositoryAgent)).resolves.toHaveLength(0);
    await expect(testDatabase.db.select().from(finding)).resolves.toHaveLength(1);
    await expect(testDatabase.db.select().from(agentEvent)).resolves.toHaveLength(1);

    const [preservedAgentRun] = await testDatabase.db.select().from(agentRun);
    expect(preservedAgentRun).toMatchObject({
      id: 'agent_run_1',
      agentId: null,
      agentSlug: 'security',
      agentDescription: 'Finds security issues',
    });

    const [preservedCostEvent] = await testDatabase.db.select().from(costEvent);
    expect(preservedCostEvent).toMatchObject({
      agentRunId: 'agent_run_1',
      agentId: null,
    });
  });
});
