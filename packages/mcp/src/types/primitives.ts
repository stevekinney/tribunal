import type { z } from 'zod';
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
} from '@modelcontextprotocol/server';
import type { McpScope } from '../scopes.js';

export type McpUserProfile = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
};

export type McpContext = {
  userId: string;
  user: McpUserProfile;
  /**
   * OBS-001: the same request identifier `application.ts` generated at
   * the HTTP boundary (`X-Request-Id`), carried through OAuth token
   * validation (`McpRequestAuthExtra.requestId`) into every tool,
   * resource, and prompt handler. Lets one connector action be traced end
   * to end through logs without correlating on anything secret (a bearer
   * token, a session cookie). Optional because standalone test contexts
   * (`createTestContext`) have no real HTTP request to derive one from.
   */
  requestId?: string;
  /**
   * PROTO-002: the SDK's own per-request `AbortSignal`
   * (`ctx.mcpReq.signal`), threaded through so a handler that awaits a
   * cancellable operation (e.g. `runWithStandardizedTimeout` from
   * `long-running-operation-support.ts`) can pass it straight through and
   * genuinely stop work when the caller disconnects or sends
   * `notifications/cancelled` — not just abandon a wrapper promise.
   */
  signal: AbortSignal;
  /**
   * Publishes a `notifications/resources/updated` event for `uri`,
   * scoped to only the authenticated user this context was built for --
   * a consuming application wires this to its own per-user event bus.
   * Undefined when no event bus is wired for this request (e.g. a
   * standalone test context) — nothing to publish to in that case.
   */
  publishResourceUpdate?: (uri: string) => Promise<void>;
};

/**
 * META-001: the four tool-safety hints the `2026-07-28` era gives real
 * weight to. All four are required (not optional) so a tool definition
 * that omits one is a compile-time error, not a silent gap a reviewer has
 * to notice by hand.
 */
export type McpToolAnnotations = {
  /** The tool only reads data; it never mutates state. */
  readOnlyHint: boolean;
  /** Calling the tool can cause irreversible or destructive effects. */
  destructiveHint: boolean;
  /** Calling the tool twice with the same input has no additional effect. */
  idempotentHint: boolean;
  /** The tool interacts with an open-ended external world, not a fixed set of resources. */
  openWorldHint: boolean;
};

/**
 * META-001: `title`, `description`, and `annotations` are required (not
 * optional), which is what turns "forgot to add metadata" into a
 * `tsc` failure on the tool's own file instead of a silent gap discovered
 * later against a live connector. `outputSchema` stays optional — a tool
 * with no structured result genuinely has none to declare — but when it
 * is present the handler's return type is checked against it, so a
 * mismatched `structuredContent` is also a compile-time error.
 *
 * `InputSchema`/`OutputSchema` default to the widest legal type so
 * `McpToolDefinition` (no type arguments) can still be used as the
 * element type of a heterogeneous `allTools` array; individual tool
 * files should let `defineTool` infer their concrete schema types instead
 * of writing the type arguments out by hand.
 */
export type McpToolDefinition<
  InputSchema extends z.ZodType = z.ZodType,
  OutputSchema extends z.ZodType | undefined = z.ZodType | undefined,
> = {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema?: OutputSchema;
  annotations: McpToolAnnotations;
  /**
   * AUTHZ-001: the single OAuth scope a caller's access token must carry to
   * invoke this tool, checked before `handler` runs (never before —
   * `tools/list` is unaffected, so a client can still see a tool it does
   * not currently have the scope to call). Required, not optional: an
   * operation with no meaningfully distinct access requirement still
   * declares the scope that best describes what it does, rather than the
   * type system silently allowing "no scope check" to mean "public."
   */
  requiredScope: McpScope;
  /** MCP Apps UI metadata (`_meta.ui.resourceUri`, `_meta.ui.visibility`). See the package `CLAUDE.md`. */
  _meta?: Record<string, unknown>;
  // Method shorthand (not an arrow-typed property) is deliberate: it keeps
  // parameter checking bivariant, which is what lets a concretely-typed
  // tool (e.g. `McpToolDefinition<GetUserProfileInput, GetUserProfileOutput>`)
  // be stored in an `McpToolDefinition[]` array without every tool file
  // having to widen its own handler's input type by hand.
  handler(
    input: z.infer<InputSchema>,
    context: McpContext,
  ): Promise<
    OutputSchema extends z.ZodType
      ? // The SDK only validates `structuredContent` against `outputSchema`
        // on a success result — an `isError: true` result is exempt (it
        // legitimately has no structured payload to validate), so this is
        // optional rather than required even though a declared
        // `outputSchema` obligates it on every non-error return.
        CallToolResult & { structuredContent?: z.infer<OutputSchema> }
      : CallToolResult
  >;
};

/**
 * Identity helper that exists only for inference: writing
 * `export const fooTool = defineTool({ ... })` lets TypeScript infer
 * `InputSchema`/`OutputSchema` from the literal `inputSchema`/`outputSchema`
 * values instead of the author spelling out `McpToolDefinition<X, Y>` by
 * hand on every tool.
 */
export function defineTool<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType | undefined = undefined,
>(
  definition: McpToolDefinition<InputSchema, OutputSchema>,
): McpToolDefinition<InputSchema, OutputSchema> {
  return definition;
}

export type McpResourceDefinition = {
  name: string;
  title: string;
  uri: string;
  description: string;
  mimeType: string;
  /** AUTHZ-001: see `McpToolDefinition.requiredScope` — same contract, checked before `resources/read` reaches `handler`. */
  requiredScope: McpScope;
  handler(uri: URL, context: McpContext): Promise<ReadResourceResult>;
};

export type McpPromptDefinition<
  Arguments extends Record<string, z.ZodType> | undefined = Record<string, z.ZodType> | undefined,
> = {
  name: string;
  title: string;
  description: string;
  // Required (not optional) so a prompt with no arguments has to spell
  // out `arguments: undefined` — an omitted key here reads as "forgot
  // to define the schema," not "intentionally none."
  arguments: Arguments;
  /** AUTHZ-001: see `McpToolDefinition.requiredScope` — same contract, checked before `prompts/get` reaches `handler`. */
  requiredScope: McpScope;
  handler(
    arguments_: Arguments extends Record<string, z.ZodType>
      ? { [Key in keyof Arguments]: z.infer<Arguments[Key]> }
      : Record<string, never>,
    context: McpContext,
  ): Promise<GetPromptResult>;
};

export function definePrompt<Arguments extends Record<string, z.ZodType> | undefined>(
  definition: McpPromptDefinition<Arguments>,
): McpPromptDefinition<Arguments> {
  return definition;
}
