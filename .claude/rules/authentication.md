---
paths:
  - src/routes/login/**
  - src/routes/onboarding/**
  - src/lib/server/auth/**
  - src/lib/server/api-keys/**
  - src/lib/schemas/user-api-key*.ts
---

# Authentication patterns

## Open redirect prevention

Always use `sanitizeReturnTo()` from `$lib/server/auth/authentication` to validate return URLs before redirecting. This prevents attackers from crafting URLs that redirect users to malicious sites after login.

```typescript
import { sanitizeReturnTo } from '$lib/server/auth/authentication';

// In load function - sanitize URL params
const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
redirect(302, returnTo);

// In form actions - sanitize form data
const returnTo = sanitizeReturnTo(formData.get('returnTo')?.toString() ?? null);
redirect(302, returnTo);
```

Apply this to **all** `returnTo` parameters from:
- URL search params (`url.searchParams.get('returnTo')`)
- Form data (`formData.get('returnTo')`)
- OAuth state (`state.returnTo`)

## API key format and parsing

User API keys follow the format `uak_<12hex>_<secret>` where:
- `uak_` is a fixed 4-character prefix
- `<12hex>` is 12 lowercase hexadecimal characters (48 bits entropy)
- `_` is a separator
- `<secret>` is a base64url-encoded random value (256 bits entropy)

**Critical**: base64url encoding uses the characters `A-Z`, `a-z`, `0-9`, `-`, and `_`. Since underscores are valid base64url characters, the secret portion may contain underscores. **Never use `split('_')` to parse API keys** - use slice-based parsing instead:

```typescript
import { KEY_PREFIX_LENGTH } from '$lib/server/api-keys/user-api-key-crypto';

// WRONG: Will break if secret contains underscores
const parts = key.split('_');
const secret = parts[2]; // May be truncated!

// CORRECT: Use slice-based parsing
const prefix = key.slice(0, KEY_PREFIX_LENGTH);
const secret = key.slice(KEY_PREFIX_LENGTH + 1); // +1 for separator
```

### Key security properties

- **Prefix lookup**: Keys are looked up by prefix first, then verified by hash
- **Timing-safe comparison**: Always use `timingSafeEqual` for hash comparisons
- **No pepper**: Keys have sufficient entropy; pepper adds rotation complexity without security benefit
- **SHA-256 hashing**: 64-character hex digest stored in database

### Validation schema boundaries

Keep validation schemas that reference server-only modules (like crypto helpers) in `$lib/server/` paths. For client-usable validation, duplicate simple constants like regex patterns in the `@tribunal/database` validation modules (`packages/database/src/validation/`).
