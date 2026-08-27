const localhostHostnames = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function isLocalhostHostname(hostname: string): boolean {
  return localhostHostnames.has(normalizeHostname(hostname));
}

function parseHostnameFromHostHeader(hostHeader: string | null): string | null {
  if (!hostHeader) {
    return null;
  }

  const firstValue = hostHeader.split(',')[0].trim();
  if (firstValue.length === 0) {
    return null;
  }

  if (firstValue.startsWith('[')) {
    const endIndex = firstValue.indexOf(']');
    if (endIndex === -1) return null;
    return firstValue.slice(0, endIndex + 1);
  }

  const separatorIndex = firstValue.indexOf(':');
  if (separatorIndex === -1) {
    return firstValue;
  }
  return firstValue.slice(0, separatorIndex);
}

function parseHostnameFromOriginHeader(originHeader: string | null): string | null {
  if (!originHeader || originHeader === 'null') {
    return null;
  }

  try {
    return new URL(originHeader).hostname;
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname: string): boolean {
  return isLocalhostHostname(hostname);
}

export function hasValidLocalhostRebindingHeaders(headers: Headers): boolean {
  const requestHost = parseHostnameFromHostHeader(headers.get('host'));
  if (requestHost && !isLocalhostHostname(requestHost)) {
    return false;
  }

  const requestOriginHost = parseHostnameFromOriginHeader(headers.get('origin'));
  if (requestOriginHost && !isLocalhostHostname(requestOriginHost)) {
    return false;
  }

  return true;
}
