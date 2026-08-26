import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createMcpServer } from './server.js';
import { getSupportedScopes } from './supported-scopes.js';
import { cancellableOperationTestHooks } from './conformance-fixture-registration.js';
import type { McpUserProfile } from './types/primitives.js';

/**
 * The `!sendRequest` branches in `test_sampling` / `test_elicitation` /
 * `test_elicitation_sep1034_defaults` / `test_elicitation_sep1330_enums`
 * (each wrapped in a v8-ignore comment pair in
 * `conformance-fixture-registration.ts`) are dead code against the
 * installed `@modelcontextprotocol/server@2.0.0` SDK: every
 * per-request `ctx.mcpReq` this SDK builds attaches a `send` function
 * unconditionally, regardless of era or the client's declared
 * capabilities -- `readRequestSender(ctx)` (`handler-context.ts`) can
 * therefore never observe it missing through any real client/server
 * exchange this package can construct (verified empirically against both
 * the legacy stateless-HTTP transport and a modern-era, protocol-pinned
 * HTTP transport, in addition to the `InMemoryTransport` this file uses --
 * all three reach the `catch` block below instead, which this file's
 * "does not support" tests do cover). Reaching the `!sendRequest` branch
 * itself would require either a source change to `handler-context.ts`
 * (out of this file's lane) or mocking that module out from under the
 * whole test run, which risks breaking every other test that imports
 * `server.ts` in the same process.
 */

/**
 * Behavioral coverage for every fixture `registerConformanceFixtures`
 * (`conformance-fixture-registration.ts`) registers directly on a real
 * `McpServer` -- there is no exported handler object for these the way
 * `defineTool`-built tools have, so the only way to invoke them is a real
 * MCP client talking to a real server.
 *
 * Uses `InMemoryTransport.createLinkedPair()` (a genuine duplex transport)
 * rather than this package's `createMcpHandler` + stateless HTTP fetch
 * pattern the other `conformance-*.test.ts` files use: a stateless HTTP
 * exchange only carries one request/response pair, so it cannot carry the
 * server-initiated `sampling/createMessage` / `elicitation/create` requests
 * several of these fixtures make back to the client mid-call (confirmed
 * empirically -- both the "client resolves immediately" and "client never
 * responds" cases hang for the full SDK default request timeout over that
 * transport, since there is no channel left open for the client's reply to
 * travel back on). `InMemoryTransport` keeps a real bidirectional queue
 * open for the life of the connection, so a genuine round trip completes in
 * milliseconds instead of only ever proving a ~60s bound.
 */

function conformanceUser(userId: string): McpUserProfile {
  return {
    id: userId,
    email: 'conformance-fixtures@localhost',
    name: 'Conformance Fixtures User',
    image: null,
    role: 'user',
  };
}

async function connectedClient(options?: {
  clientOptions?: ConstructorParameters<typeof Client>[1];
  publishResourceUpdate?: (uri: string) => Promise<void>;
}): Promise<Client> {
  const userId = randomUUID();
  const server = createMcpServer({
    userId,
    user: conformanceUser(userId),
    enableUiExtension: false,
    enableConformanceMode: true,
    scopes: getSupportedScopes(),
    publishResourceUpdate: options?.publishResourceUpdate,
  });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'conformance-fixtures-client', version: '1.0.0' },
    options?.clientOptions,
  );
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('conformance fixture tools: simple content shapes', () => {
  it('test_simple_text returns a single plain-text content block', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_simple_text', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'This is a simple text response.' }]);
    await client.close();
  });

  it('test_error_handling always returns a tool-level error result', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_error_handling', arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'This is a deliberate test error.',
    );
    await client.close();
  });

  it('test_image_content returns a base64-encoded PNG image block', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_image_content', arguments: {} });
    expect(result.isError).not.toBe(true);
    const block = result.content?.[0] as { type?: string; mimeType?: string; data?: string };
    expect(block.type).toBe('image');
    expect(block.mimeType).toBe('image/png');
    expect(typeof block.data).toBe('string');
    expect((block.data ?? '').length).toBeGreaterThan(0);
    await client.close();
  });

  it('test_audio_content returns a base64-encoded WAV audio block', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_audio_content', arguments: {} });
    expect(result.isError).not.toBe(true);
    const block = result.content?.[0] as { type?: string; mimeType?: string; data?: string };
    expect(block.type).toBe('audio');
    expect(block.mimeType).toBe('audio/wav');
    expect(typeof block.data).toBe('string');
    await client.close();
  });

  it('test_embedded_resource returns an embedded text resource content block', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_embedded_resource', arguments: {} });
    expect(result.isError).not.toBe(true);
    const block = result.content?.[0] as {
      type?: string;
      resource?: { uri?: string; text?: string };
    };
    expect(block.type).toBe('resource');
    expect(block.resource?.uri).toBe('test://embedded-resource');
    expect(block.resource?.text).toBe('This is an embedded resource content.');
    await client.close();
  });

  it('test_multiple_content_types returns text, image, and resource blocks together', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_multiple_content_types', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content?.length).toBe(3);
    expect((result.content?.[0] as { type?: string } | undefined)?.type).toBe('text');
    expect((result.content?.[1] as { type?: string } | undefined)?.type).toBe('image');
    expect((result.content?.[2] as { type?: string } | undefined)?.type).toBe('resource');
    await client.close();
  });
});

describe('conformance fixture tools: notifications', () => {
  it('test_tool_with_logging sends notifications/message logging notifications during execution', async () => {
    const client = await connectedClient();
    const loggingMessages: unknown[] = [];
    client.setNotificationHandler('notifications/message', (notification) => {
      loggingMessages.push(notification.params);
    });

    const result = await client.callTool({ name: 'test_tool_with_logging', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Logging tool execution completed.',
    );
    expect(loggingMessages.length).toBe(3);

    await client.close();
  });

  it('test_tool_with_progress sends progress notifications when the caller supplies a progress token', async () => {
    const client = await connectedClient();
    const progressUpdates: unknown[] = [];

    const result = await client.callTool(
      { name: 'test_tool_with_progress', arguments: {} },
      {
        onprogress: (progress) => {
          progressUpdates.push(progress);
        },
      },
    );
    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Progress tool execution completed.',
    );
    expect(progressUpdates.length).toBe(3);

    await client.close();
  });

  it('test_tool_with_progress falls back to a plain delay when the caller supplies no progress token', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'test_tool_with_progress', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Progress tool execution completed.',
    );
    await client.close();
  });
});

describe('conformance fixture tools: sampling', () => {
  it('test_sampling relays the client sampling response as LLM response text', async () => {
    const client = await connectedClient({ clientOptions: { capabilities: { sampling: {} } } });
    client.setRequestHandler('sampling/createMessage', () => ({
      model: 'test-model',
      role: 'assistant',
      content: { type: 'text', text: 'a sampled reply' },
    }));

    const result = await client.callTool({
      name: 'test_sampling',
      arguments: { prompt: 'say something' },
    });
    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'LLM response: a sampled reply',
    );

    await client.close();
  });

  it('test_sampling reports isError when the client does not support sampling', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'test_sampling',
      arguments: { prompt: 'say something' },
    });
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Sampling is not supported by this client.',
    );
    await client.close();
  });
});

describe('conformance fixture tools: elicitation', () => {
  it('test_elicitation relays the client action and content', async () => {
    const client = await connectedClient({ clientOptions: { capabilities: { elicitation: {} } } });
    client.setRequestHandler('elicitation/create', () => ({
      action: 'accept',
      content: { username: 'ada', email: 'ada@example.com' },
    }));

    const result = await client.callTool({
      name: 'test_elicitation',
      arguments: { message: 'who are you?' },
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).toContain('action=accept');
    expect(text).toContain('ada@example.com');

    await client.close();
  });

  it('test_elicitation reports isError when the client does not support elicitation', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'test_elicitation',
      arguments: { message: 'who are you?' },
    });
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Elicitation is not supported by this client.',
    );
    await client.close();
  });

  it('test_elicitation_sep1034_defaults relays the completed elicitation result', async () => {
    const client = await connectedClient({ clientOptions: { capabilities: { elicitation: {} } } });
    client.setRequestHandler('elicitation/create', () => ({
      action: 'accept',
      content: { name: 'John Doe', age: 30, score: 95.5, status: 'active', verified: true },
    }));

    const result = await client.callTool({
      name: 'test_elicitation_sep1034_defaults',
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).toContain('Elicitation completed: action=accept');

    await client.close();
  });

  it('test_elicitation_sep1034_defaults reports isError when the client does not support elicitation', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'test_elicitation_sep1034_defaults',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Elicitation is not supported by this client.',
    );
    await client.close();
  });

  it('test_elicitation_sep1330_enums relays the completed elicitation result', async () => {
    const client = await connectedClient({ clientOptions: { capabilities: { elicitation: {} } } });
    client.setRequestHandler('elicitation/create', () => ({
      action: 'accept',
      content: {
        untitledSingle: 'option1',
        titledSingle: 'value1',
        legacyEnum: 'opt1',
        untitledMulti: ['option1'],
        titledMulti: ['value1'],
      },
    }));

    const result = await client.callTool({
      name: 'test_elicitation_sep1330_enums',
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const text = (result.content?.[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).toContain('Elicitation completed: action=accept');

    await client.close();
  });

  it('test_elicitation_sep1330_enums reports isError when the client does not support elicitation', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'test_elicitation_sep1330_enums',
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Elicitation is not supported by this client.',
    );
    await client.close();
  });
});

describe('conformance fixture resources', () => {
  it('lists and reads test_static_text_resource', async () => {
    const client = await connectedClient();
    const resources = await client.listResources();
    expect(
      resources.resources.some((resource) => resource.name === 'test_static_text_resource'),
    ).toBe(true);

    const result = await client.readResource({ uri: 'test://static-text' });
    expect(result.contents[0]?.text).toBe('This is the content of the static text resource.');
    await client.close();
  });

  it('lists and reads test_static_binary_resource as a blob', async () => {
    const client = await connectedClient();
    const resources = await client.listResources();
    expect(
      resources.resources.some((resource) => resource.name === 'test_static_binary_resource'),
    ).toBe(true);

    const result = await client.readResource({ uri: 'test://static-binary' });
    const content = result.contents[0] as { blob?: string; mimeType?: string };
    expect(content.mimeType).toBe('image/png');
    expect(typeof content.blob).toBe('string');
    await client.close();
  });

  it('lists and reads a templated resource, threading the URI variable into the response', async () => {
    const client = await connectedClient();
    const templates = await client.listResourceTemplates();
    expect(
      templates.resourceTemplates.some((template) => template.name === 'test_template_resource'),
    ).toBe(true);

    const result = await client.readResource({ uri: 'test://template/abc-123/data' });
    const content = result.contents[0] as { text?: string };
    expect(content.text).toContain('"id":"abc-123"');
    expect(content.text).toContain('Data for ID: abc-123');
    await client.close();
  });
});

describe('conformance fixture prompts', () => {
  it('test_simple_prompt returns a single fixed user message', async () => {
    const client = await connectedClient();
    const prompts = await client.listPrompts();
    expect(prompts.prompts.some((prompt) => prompt.name === 'test_simple_prompt')).toBe(true);

    const result = await client.getPrompt({ name: 'test_simple_prompt' });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.content).toEqual({
      type: 'text',
      text: 'This is a simple prompt for testing.',
    });
    await client.close();
  });

  it('test_prompt_with_arguments interpolates both arguments into the message text', async () => {
    const client = await connectedClient();
    const result = await client.getPrompt({
      name: 'test_prompt_with_arguments',
      arguments: { arg1: 'paris', arg2: 'second' },
    });
    const content = result.messages[0]?.content as { text?: string };
    expect(content.text).toBe("Prompt with arguments: arg1='paris', arg2='second'");
    await client.close();
  });

  it('test_prompt_with_arguments completes arg1 against the fixed paris/park/party list, filtered by prefix', async () => {
    const client = await connectedClient();
    const completion = await client.complete({
      ref: { type: 'ref/prompt', name: 'test_prompt_with_arguments' },
      argument: { name: 'arg1', value: 'par' },
    });
    expect(completion.completion.values).toEqual(['paris', 'park', 'party']);
    await client.close();
  });

  it('test_prompt_with_embedded_resource embeds the requested resource URI and a follow-up instruction', async () => {
    const client = await connectedClient();
    const result = await client.getPrompt({
      name: 'test_prompt_with_embedded_resource',
      arguments: { resourceUri: 'test://embedded-resource' },
    });
    expect(result.messages).toHaveLength(2);
    const embedded = result.messages[0]?.content as { type?: string; resource?: { uri?: string } };
    expect(embedded.type).toBe('resource');
    expect(embedded.resource?.uri).toBe('test://embedded-resource');
    const followUp = result.messages[1]?.content as { text?: string };
    expect(followUp.text).toBe('Please process the embedded resource above.');
    await client.close();
  });

  it('test_prompt_with_image returns an image message followed by an instruction message', async () => {
    const client = await connectedClient();
    const result = await client.getPrompt({ name: 'test_prompt_with_image' });
    expect(result.messages).toHaveLength(2);
    const image = result.messages[0]?.content as { type?: string; mimeType?: string };
    expect(image.type).toBe('image');
    expect(image.mimeType).toBe('image/png');
    const followUp = result.messages[1]?.content as { text?: string };
    expect(followUp.text).toBe('Please analyze the image above.');
    await client.close();
  });
});

describe('test_watched_resource_update', () => {
  it('publishes through the provided publishResourceUpdate callback when one is wired', async () => {
    const publishedUris: string[] = [];
    const client = await connectedClient({
      publishResourceUpdate: async (uri) => {
        publishedUris.push(uri);
      },
    });

    const result = await client.callTool({
      name: 'test_watched_resource_update',
      arguments: { uri: 'test://static-text' },
    });
    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Sent a resource update notification for test://static-text.',
    );
    expect(publishedUris).toEqual(['test://static-text']);

    await client.close();
  });

  it('falls back to the server-level resource update notification when no publishResourceUpdate is wired', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'test_watched_resource_update',
      arguments: { uri: 'test://static-text' },
    });
    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Sent a resource update notification for test://static-text.',
    );
    await client.close();
  });
});

/**
 * `delay()`'s `signal?.aborted` early-reject branch (lines 20-22) is not
 * covered by anything below: `runWithStandardizedTimeout` (which is what
 * `test_cancellable_operation` calls `delay` through) always constructs a
 * fresh, unaborted `AbortController` and passes ITS signal into the
 * operation, so `delay()` can only ever observe that signal transition from
 * unaborted to aborted after the call already started (the case the abort
 * test below covers via the listener path a few lines down) -- never
 * already-aborted at call time. Hitting the early branch would require a
 * caller-supplied `ctx.mcpReq.signal` that is already aborted before this
 * fixture's handler body even runs, which is a request-dispatch race this
 * package's test harnesses (real client, real transport) cannot force
 * deterministically -- the client-side abort in the test below is
 * observed to always reject the client's own `callTool` promise locally,
 * before the request that it names even reaches the server.
 */
describe('test_cancellable_operation', () => {
  it('completes normally and increments completedCount when not aborted', async () => {
    cancellableOperationTestHooks.reset();
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'test_cancellable_operation',
      arguments: { delayMilliseconds: 10 },
    });

    expect(result.isError).not.toBe(true);
    expect((result.content?.[0] as { text?: string } | undefined)?.text).toBe(
      'Cancellable operation completed.',
    );
    expect(cancellableOperationTestHooks.completedCount).toBe(1);
    expect(cancellableOperationTestHooks.abortedCount).toBe(0);

    await client.close();
  });

  it('is torn down when the caller aborts before the delay elapses, and never increments completedCount', async () => {
    cancellableOperationTestHooks.reset();
    const client = await connectedClient();
    const controller = new AbortController();

    const callPromise = client.callTool(
      { name: 'test_cancellable_operation', arguments: { delayMilliseconds: 5_000 } },
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 50);

    let sawRejectionOrError: boolean;
    try {
      const result = await callPromise;
      sawRejectionOrError = result.isError === true;
    } catch {
      sawRejectionOrError = true;
    }

    expect(sawRejectionOrError).toBe(true);
    expect(cancellableOperationTestHooks.completedCount).toBe(0);

    await client.close().catch(() => {});
  }, 10_000);
});
