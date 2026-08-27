import { expect } from 'vitest';

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

export function expectToolSuccess(result: ToolResult): void {
  expect(result.content).toBeDefined();
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.isError).not.toBe(true);
}

export function expectToolError(result: ToolResult): void {
  expect(result.content).toBeDefined();
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.isError).toBe(true);
}

export function expectToolJsonContent(result: ToolResult): unknown {
  expectToolSuccess(result);
  const text = result.content[0]?.text;
  expect(text).toBeDefined();
  return JSON.parse(text!);
}
