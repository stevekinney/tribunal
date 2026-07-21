import { describe, expect, it } from 'vitest';
import {
  createUserApiKeySchema,
  MAX_USER_API_KEYS,
  revokeUserApiKeySchema,
  rotateUserApiKeySchema,
  USER_API_KEY_PREFIX_REGEX,
  UserApiKeyErrorCode,
  userApiKeyCheckResponseSchema,
  userApiKeyCreatedSchema,
  userApiKeyDetailSchema,
  userApiKeyListItemSchema,
  userApiKeyPrefixSchema,
} from './user-api-key';

describe('createUserApiKeySchema', () => {
  it('accepts a name with no description', () => {
    const result = createUserApiKeySchema.parse({ name: 'CI Token' });

    expect(result.name).toBe('CI Token');
    expect(result.description).toBeNull();
  });

  it('accepts a name and description', () => {
    const result = createUserApiKeySchema.parse({
      name: 'CI Token',
      description: 'Used by the release pipeline',
    });

    expect(result.description).toBe('Used by the release pipeline');
  });

  it('converts an empty description to null', () => {
    const result = createUserApiKeySchema.parse({ name: 'CI Token', description: '  ' });

    expect(result.description).toBeNull();
  });

  it('rejects a name over 255 characters', () => {
    expect(() => createUserApiKeySchema.parse({ name: 'a'.repeat(256) })).toThrow(
      'Name must be 255 characters or less',
    );
  });

  it('rejects a name that is empty after trimming', () => {
    expect(() => createUserApiKeySchema.parse({ name: '   ' })).toThrow();
  });

  it('rejects a description over 1000 characters', () => {
    expect(() =>
      createUserApiKeySchema.parse({ name: 'CI Token', description: 'a'.repeat(1001) }),
    ).toThrow('Description must be 1000 characters or less');
  });
});

describe('rotateUserApiKeySchema', () => {
  it('coerces a numeric string keyId', () => {
    expect(rotateUserApiKeySchema.parse({ keyId: '7' })).toEqual({ keyId: 7 });
  });

  it('rejects a non-positive keyId', () => {
    expect(() => rotateUserApiKeySchema.parse({ keyId: 0 })).toThrow();
  });
});

describe('revokeUserApiKeySchema', () => {
  it('accepts a positive integer keyId', () => {
    expect(revokeUserApiKeySchema.parse({ keyId: 3 })).toEqual({ keyId: 3 });
  });

  it('rejects a negative keyId', () => {
    expect(() => revokeUserApiKeySchema.parse({ keyId: -1 })).toThrow();
  });
});

describe('userApiKeyPrefixSchema', () => {
  it('accepts a well-formed prefix', () => {
    expect(userApiKeyPrefixSchema.parse('uak_1234567890ab')).toBe('uak_1234567890ab');
  });

  it('rejects a malformed prefix', () => {
    expect(() => userApiKeyPrefixSchema.parse('not-a-prefix')).toThrow('Invalid key prefix format');
  });
});

describe('USER_API_KEY_PREFIX_REGEX', () => {
  it('matches the documented uak_<12hex> shape', () => {
    expect(USER_API_KEY_PREFIX_REGEX.test('uak_0123456789ab')).toBe(true);
  });

  it('rejects a prefix with the wrong hex length', () => {
    expect(USER_API_KEY_PREFIX_REGEX.test('uak_01234567')).toBe(false);
  });

  it('rejects uppercase hex characters', () => {
    expect(USER_API_KEY_PREFIX_REGEX.test('uak_0123456789AB')).toBe(false);
  });
});

describe('response schemas', () => {
  it('parses a created key response including the raw key', () => {
    const result = userApiKeyCreatedSchema.parse({
      id: 1,
      name: 'CI Token',
      description: null,
      keyPrefix: 'uak_0123456789ab',
      rawKey: 'uak_0123456789ab.rest-of-secret',
      createdAt: new Date(),
    });

    expect(result.rawKey).toContain('uak_0123456789ab');
  });

  it('parses a list item response without a raw key field', () => {
    const result = userApiKeyListItemSchema.parse({
      id: 1,
      name: 'CI Token',
      description: null,
      keyPrefix: 'uak_0123456789ab',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
    });

    expect(result).not.toHaveProperty('rawKey');
  });

  it('parses a detail response extending the list item shape', () => {
    const result = userApiKeyDetailSchema.parse({
      id: 1,
      name: 'CI Token',
      description: null,
      keyPrefix: 'uak_0123456789ab',
      createdAt: new Date(),
      expiresAt: null,
      revokedAt: null,
      updatedAt: new Date(),
    });

    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it('parses a check response for a valid key', () => {
    const result = userApiKeyCheckResponseSchema.parse({
      ok: true,
      key: { id: 1, userId: 2, prefix: 'uak_0123456789ab', name: 'CI Token' },
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a check response with ok: false', () => {
    expect(() =>
      userApiKeyCheckResponseSchema.parse({
        ok: false,
        key: { id: 1, userId: 2, prefix: 'uak_0123456789ab', name: 'CI Token' },
      }),
    ).toThrow();
  });
});

describe('constants', () => {
  it('limits users to 10 active API keys', () => {
    expect(MAX_USER_API_KEYS).toBe(10);
  });

  it('defines an error code for every documented failure mode', () => {
    expect(UserApiKeyErrorCode).toEqual({
      KEY_LIMIT_REACHED: 'KEY_LIMIT_REACHED',
      INVALID_KEY_FORMAT: 'INVALID_KEY_FORMAT',
      KEY_NOT_FOUND: 'KEY_NOT_FOUND',
      KEY_ALREADY_REVOKED: 'KEY_ALREADY_REVOKED',
      NAME_EMPTY: 'NAME_EMPTY',
    });
  });
});
