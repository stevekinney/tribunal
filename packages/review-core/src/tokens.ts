export type OpaqueToken = string & { readonly __opaqueToken: unique symbol };

export function toOpaqueToken(token: string): OpaqueToken {
  if (token.length === 0) {
    throw new Error('Token must be a non-empty string.');
  }

  return token as OpaqueToken;
}

export function exposeTokenForCredentialInjection(token: OpaqueToken): string {
  return token;
}
