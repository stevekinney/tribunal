import { describe, expect, it } from 'vitest';
import { validateEnvironmentValues } from './environment-doctor';

const DEV_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/tribunal',
} satisfies Record<string, string>;

describe('validateEnvironmentValues', () => {
  it('reports success when values pass the schema (AC10)', () => {
    const result = validateEnvironmentValues(DEV_ENV);
    expect(result.level).toBe('success');
    expect(result.message).toMatch(/pass schema validation/);
  });

  it('reports a schema failure for a value that passes presence but blocks boot', () => {
    // NODE_ENV is present, so a presence check would pass, but 'staging' is not a
    // permitted value and the server would refuse to start.
    const result = validateEnvironmentValues({ ...DEV_ENV, NODE_ENV: 'staging' });
    expect(result.level).toBe('error');
    expect(result.message).toMatch(/fail schema validation/);
    expect(result.message).toContain('NODE_ENV');
  });

  it('reports a production DATABASE_URL weaker than sslmode=verify-full', () => {
    const result = validateEnvironmentValues({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db.example.neon.tech/tribunal?sslmode=require',
    });
    expect(result.level).toBe('error');
    expect(result.message).toMatch(/verify-full/);
  });

  it('reports the SKIP_ENV_VALIDATION ban as a validation error (non-Zod throw)', () => {
    const result = validateEnvironmentValues({ ...DEV_ENV, SKIP_ENV_VALIDATION: '1' });
    expect(result.level).toBe('error');
    expect(result.message).toMatch(/Environment validation error/);
    expect(result.message).toContain('SKIP_ENV_VALIDATION');
  });
});
