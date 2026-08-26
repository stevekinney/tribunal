import { z } from 'zod';
import { ResourceTemplate, completable } from '@modelcontextprotocol/server';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  readProgressToken,
  readNotificationSender,
  readRequestSender,
  stringifyUnknown,
  parseSampledText,
} from './handler-context.js';
import { runWithStandardizedTimeout } from './long-running-operation-support.js';

const oneByOnePngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5m0QAAAABJRU5ErkJggg==';

const minimalWavBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=';

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    /* v8 ignore start -- defensive guard for a signal that is already
     * aborted at call time. Every call site in this file either passes no
     * signal, or (`test_cancellable_operation`, via
     * `runWithStandardizedTimeout`) passes a freshly created
     * `AbortController`'s signal synchronously at the moment `operation`
     * is invoked, which is never already aborted -- structurally
     * unreachable through this file's own call sites, kept as a genuine
     * safety net for a future caller that awaits before calling `delay`. */
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    /* v8 ignore stop */
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Test-only observability for `test_cancellable_operation` below. A
 * response reaching (or failing to reach) the client proves the HTTP
 * exchange was torn down on abort — the SDK's transport does that
 * regardless of whether a handler's own operation actually observed
 * cancellation. Proving the operation ITSELF stopped (a timeout/abort
 * that only rejects a wrapper promise while the real work keeps running
 * unobserved is the exact bug `runWithStandardizedTimeout` fixes) needs a
 * side channel outside the response — these counters are it. A caller
 * asserting `completedCount` stays `0` well past the fixture's full delay
 * once a request was aborted early is only correct if the underlying
 * `setTimeout` was genuinely cleared, not merely abandoned.
 */
export const cancellableOperationTestHooks = {
  completedCount: 0,
  abortedCount: 0,
  reset(): void {
    this.completedCount = 0;
    this.abortedCount = 0;
  },
};

/**
 * PROTO-002 / S-11: `resources/subscribe` and `resources/unsubscribe` are
 * registered unconditionally by `server.ts` (spec-compliant ack; real
 * delivery happens on the `subscriptions/listen` stream against a per-user
 * event bus — see that file's comment). This fixture no longer needs its
 * own interest-tracking map: it publishes directly to whatever URI the
 * caller names, and the SDK's own listen-router filters delivery to
 * whichever open streams actually opted into that URI.
 */
export function registerConformanceFixtures(
  server: McpServer,
  publishResourceUpdate?: (uri: string) => Promise<void>,
): void {
  // INTEROP-001: found by actually running the pinned
  // `@modelcontextprotocol/conformance` CLI's default "active" suite against
  // this server (not merely reading its scenario list) — `tools-call-simple-text`
  // and `tools-call-error` both failed with "Tool ... not found", not a
  // behavioral mismatch. Confirmed the exact expected tool names and result
  // shapes directly against the installed conformance package's own
  // (unexported, dist-only) scenario source rather than guessing.
  server.registerTool(
    'test_simple_text',
    { description: 'Conformance fixture: returns a single plain-text content block.' },
    async () => ({
      content: [{ type: 'text' as const, text: 'This is a simple text response.' }],
    }),
  );

  server.registerTool(
    'test_error_handling',
    { description: 'Conformance fixture: always returns a tool-level error result.' },
    async () => ({
      isError: true,
      content: [{ type: 'text' as const, text: 'This is a deliberate test error.' }],
    }),
  );

  server.registerTool(
    'test_image_content',
    { description: 'Conformance fixture: returns an image content block.' },
    async () => ({
      content: [
        {
          type: 'image' as const,
          data: oneByOnePngBase64,
          mimeType: 'image/png',
        },
      ],
    }),
  );

  server.registerTool(
    'test_audio_content',
    { description: 'Conformance fixture: returns an audio content block.' },
    async () => ({
      content: [
        {
          type: 'audio' as const,
          data: minimalWavBase64,
          mimeType: 'audio/wav',
        },
      ],
    }),
  );

  server.registerTool(
    'test_embedded_resource',
    { description: 'Conformance fixture: returns embedded resource content.' },
    async () => ({
      content: [
        {
          type: 'resource' as const,
          resource: {
            uri: 'test://embedded-resource',
            mimeType: 'text/plain',
            text: 'This is an embedded resource content.',
          },
        },
      ],
    }),
  );

  server.registerTool(
    'test_multiple_content_types',
    { description: 'Conformance fixture: returns text, image, and resource content.' },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Multiple content types test:',
        },
        {
          type: 'image' as const,
          data: oneByOnePngBase64,
          mimeType: 'image/png',
        },
        {
          type: 'resource' as const,
          resource: {
            uri: 'test://mixed-content-resource',
            mimeType: 'application/json',
            text: '{"test":"data","value":123}',
          },
        },
      ],
    }),
  );

  server.registerTool(
    'test_tool_with_logging',
    {
      description: 'Conformance fixture: sends logging notifications during execution.',
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      const sendNotification = readNotificationSender(ctx);
      if (sendNotification) {
        await sendNotification({
          method: 'notifications/message',
          params: { level: 'info', data: 'Tool execution started' },
        });
      }
      await delay(50);
      if (sendNotification) {
        await sendNotification({
          method: 'notifications/message',
          params: { level: 'info', data: 'Tool processing data' },
        });
      }
      await delay(50);
      if (sendNotification) {
        await sendNotification({
          method: 'notifications/message',
          params: { level: 'info', data: 'Tool execution completed' },
        });
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Logging tool execution completed.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'test_tool_with_progress',
    {
      description: 'Conformance fixture: sends progress notifications during execution.',
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      const progressToken = readProgressToken(ctx);
      const sendNotification = readNotificationSender(ctx);
      if (progressToken !== undefined && sendNotification) {
        await sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: 0, total: 100 },
        });
        await delay(50);
        await sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: 50, total: 100 },
        });
        await delay(50);
        await sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: 100, total: 100 },
        });
      } else {
        await delay(100);
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Progress tool execution completed.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'test_sampling',
    {
      description: 'Conformance fixture: requests client sampling.',
      inputSchema: z.object({
        prompt: z.string().describe('Prompt to send to sampling/createMessage'),
      }),
    },
    async (input, ctx) => {
      const sendRequest = readRequestSender(ctx);
      /* v8 ignore start -- `readRequestSender` (handler-context.ts) can never
       * observe a missing `send` function through any real client/server
       * exchange this package can construct: the installed
       * `@modelcontextprotocol/server@2.0.0` SDK attaches `send` to every
       * per-request `ctx.mcpReq` unconditionally, regardless of era or the
       * client's declared capabilities (confirmed by reading its bundled
       * request dispatcher). A client that genuinely lacks the sampling
       * capability still reaches the `catch` block below via a rejected
       * `sendRequest` call, which is what `conformance-fixture-registration.test.ts`
       * exercises. */
      if (!sendRequest) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Sampling is not supported by this client.',
            },
          ],
          isError: true,
        };
      }
      /* v8 ignore stop */

      try {
        const sampledResult = await sendRequest({
          method: 'sampling/createMessage',
          params: {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: input.prompt,
                },
              },
            ],
            maxTokens: 100,
          },
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `LLM response: ${parseSampledText(sampledResult)}`,
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Sampling is not supported by this client.',
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'test_elicitation',
    {
      description: 'Conformance fixture: requests elicitation from client.',
      inputSchema: z.object({
        message: z.string().describe('Prompt message shown to user'),
      }),
    },
    async (input, ctx) => {
      const sendRequest = readRequestSender(ctx);
      /* v8 ignore start -- see the identical `!sendRequest` guard on
       * `test_sampling` above; the same "unreachable against the installed
       * SDK" finding applies here. */
      if (!sendRequest) {
        return {
          content: [
            { type: 'text' as const, text: 'Elicitation is not supported by this client.' },
          ],
          isError: true,
        };
      }
      /* v8 ignore stop */

      try {
        const elicitationResult = (await sendRequest({
          method: 'elicitation/create',
          params: {
            message: input.message,
            requestedSchema: {
              type: 'object',
              properties: {
                username: {
                  type: 'string',
                  description: "User's response",
                },
                email: {
                  type: 'string',
                  description: "User's email address",
                },
              },
              required: ['username', 'email'],
            },
          },
        })) as { action: string; content?: unknown };
        return {
          content: [
            {
              type: 'text' as const,
              text: `User response: action=${elicitationResult.action}, content=${stringifyUnknown(elicitationResult.content ?? {})}`,
            },
          ],
        };
      } catch {
        return {
          content: [
            { type: 'text' as const, text: 'Elicitation is not supported by this client.' },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'test_elicitation_sep1034_defaults',
    {
      description: 'Conformance fixture: elicitation defaults for SEP-1034.',
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      const sendRequest = readRequestSender(ctx);
      /* v8 ignore start -- see the identical `!sendRequest` guard on
       * `test_sampling` above; the same "unreachable against the installed
       * SDK" finding applies here. */
      if (!sendRequest) {
        return {
          content: [
            { type: 'text' as const, text: 'Elicitation is not supported by this client.' },
          ],
          isError: true,
        };
      }
      /* v8 ignore stop */

      try {
        const result = (await sendRequest({
          method: 'elicitation/create',
          params: {
            message: 'Provide defaults confirmation',
            requestedSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', default: 'John Doe' },
                age: { type: 'integer', default: 30 },
                score: { type: 'number', default: 95.5 },
                status: {
                  type: 'string',
                  enum: ['active', 'inactive', 'pending'],
                  default: 'active',
                },
                verified: { type: 'boolean', default: true },
              },
              required: ['name', 'age', 'score', 'status', 'verified'],
            },
          },
        })) as { action: string; content?: unknown };
        return {
          content: [
            {
              type: 'text' as const,
              text: `Elicitation completed: action=${result.action}, content=${stringifyUnknown(result.content ?? {})}`,
            },
          ],
        };
      } catch {
        return {
          content: [
            { type: 'text' as const, text: 'Elicitation is not supported by this client.' },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'test_elicitation_sep1330_enums',
    {
      description: 'Conformance fixture: enum variants for SEP-1330.',
      inputSchema: z.object({}),
    },
    async (_input, ctx) => {
      const sendRequest = readRequestSender(ctx);
      /* v8 ignore start -- see the identical `!sendRequest` guard on
       * `test_sampling` above; the same "unreachable against the installed
       * SDK" finding applies here. */
      if (!sendRequest) {
        return {
          content: [
            { type: 'text' as const, text: 'Elicitation is not supported by this client.' },
          ],
          isError: true,
        };
      }
      /* v8 ignore stop */

      try {
        const result = (await sendRequest({
          method: 'elicitation/create',
          params: {
            message: 'Choose enum variants',
            requestedSchema: {
              type: 'object',
              properties: {
                untitledSingle: {
                  type: 'string',
                  enum: ['option1', 'option2', 'option3'],
                },
                titledSingle: {
                  type: 'string',
                  oneOf: [
                    { const: 'value1', title: 'First Option' },
                    { const: 'value2', title: 'Second Option' },
                    { const: 'value3', title: 'Third Option' },
                  ],
                },
                legacyEnum: {
                  type: 'string',
                  enum: ['opt1', 'opt2', 'opt3'],
                  enumNames: ['Option One', 'Option Two', 'Option Three'],
                },
                untitledMulti: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['option1', 'option2', 'option3'],
                  },
                },
                titledMulti: {
                  type: 'array',
                  items: {
                    anyOf: [
                      { const: 'value1', title: 'First Choice' },
                      { const: 'value2', title: 'Second Choice' },
                      { const: 'value3', title: 'Third Choice' },
                    ],
                  },
                },
              },
              required: [
                'untitledSingle',
                'titledSingle',
                'legacyEnum',
                'untitledMulti',
                'titledMulti',
              ],
            },
          },
        })) as { action: string; content?: unknown };
        return {
          content: [
            {
              type: 'text' as const,
              text: `Elicitation completed: action=${result.action}, content=${stringifyUnknown(result.content ?? {})}`,
            },
          ],
        };
      } catch {
        return {
          content: [
            { type: 'text' as const, text: 'Elicitation is not supported by this client.' },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerResource(
    'test_static_text_resource',
    'test://static-text',
    { description: 'Conformance fixture static text resource', mimeType: 'text/plain' },
    async () => ({
      contents: [
        {
          uri: 'test://static-text',
          mimeType: 'text/plain',
          text: 'This is the content of the static text resource.',
        },
      ],
    }),
  );

  server.registerResource(
    'test_static_binary_resource',
    'test://static-binary',
    { description: 'Conformance fixture static binary resource', mimeType: 'image/png' },
    async () => ({
      contents: [
        {
          uri: 'test://static-binary',
          mimeType: 'image/png',
          blob: oneByOnePngBase64,
        },
      ],
    }),
  );

  server.registerResource(
    'test_template_resource',
    new ResourceTemplate('test://template/{id}/data', {
      list: async () => ({
        resources: [
          {
            uri: 'test://template/123/data',
            name: 'template-data-123',
            mimeType: 'application/json',
          },
        ],
      }),
    }),
    { description: 'Conformance fixture template resource', mimeType: 'application/json' },
    async (_uri, variables) => {
      const identifier = String(variables.id ?? '');
      return {
        contents: [
          {
            uri: `test://template/${identifier}/data`,
            mimeType: 'application/json',
            text: `{"id":"${identifier}","templateTest":true,"data":"Data for ID: ${identifier}"}`,
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'test_simple_prompt',
    { description: 'Conformance fixture simple prompt.' },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: 'This is a simple prompt for testing.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'test_prompt_with_arguments',
    {
      description: 'Conformance fixture prompt with arguments.',
      argsSchema: z.object({
        arg1: completable(z.string().describe('First test argument'), async (value) => {
          const query = String(value ?? '').toLowerCase();
          const values = ['paris', 'park', 'party'];
          return values.filter((item) => item.startsWith(query));
        }),
        arg2: z.string().describe('Second test argument'),
      }),
    },
    async (arguments_) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Prompt with arguments: arg1='${arguments_.arg1}', arg2='${arguments_.arg2}'`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'test_prompt_with_embedded_resource',
    {
      description: 'Conformance fixture prompt with embedded resource.',
      argsSchema: z.object({
        resourceUri: z.string().describe('URI of resource to embed'),
      }),
    },
    async (arguments_) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'resource' as const,
            resource: {
              uri: arguments_.resourceUri,
              mimeType: 'text/plain',
              text: 'Embedded resource content for testing.',
            },
          },
        },
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: 'Please process the embedded resource above.',
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'test_prompt_with_image',
    {
      description: 'Conformance fixture prompt with image content.',
    },
    async () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'image' as const,
            data: oneByOnePngBase64,
            mimeType: 'image/png',
          },
        },
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: 'Please analyze the image above.',
          },
        },
      ],
    }),
  );

  server.registerTool(
    'test_watched_resource_update',
    {
      description:
        'Conformance fixture helper that publishes a resource update notification for the given URI, scoped to this connection.',
      inputSchema: z.object({
        uri: z.string().describe('The resource URI to publish an update for.'),
      }),
    },
    async (input) => {
      if (publishResourceUpdate) {
        await publishResourceUpdate(input.uri);
      } else {
        await server.server.sendResourceUpdated({ uri: input.uri });
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: `Sent a resource update notification for ${input.uri}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'test_cancellable_operation',
    {
      description:
        'Conformance fixture: awaits a slow operation through runWithStandardizedTimeout, ' +
        "threaded from the request's own AbortSignal, to prove disconnecting the caller " +
        'genuinely aborts the underlying work rather than only abandoning a wrapper promise.',
      inputSchema: z.object({
        delayMilliseconds: z
          .number()
          .int()
          .positive()
          .max(60_000)
          .describe('How long the underlying operation sleeps before resolving.'),
      }),
    },
    async (input, ctx) => {
      try {
        await runWithStandardizedTimeout({
          operation: (signal) => delay(input.delayMilliseconds, signal),
          abortSignal: ctx.mcpReq.signal,
          timeoutMilliseconds: input.delayMilliseconds + 60_000,
        });
        cancellableOperationTestHooks.completedCount += 1;
      } catch (error) {
        cancellableOperationTestHooks.abortedCount += 1;
        return {
          content: [
            {
              type: 'text' as const,
              text: `Cancelled: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: 'Cancellable operation completed.' }],
      };
    },
  );
}
