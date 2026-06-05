export function sanitizeReturnTo(url: string | null): string {
  if (!url) return '/';
  if (!url.startsWith('/') || url.startsWith('//')) return '/';

  const lower = url.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) return '/';

  try {
    const parsed = new URL(url, 'https://tribunal.local');
    if (parsed.pathname === '/connect/github/account/callback') return '/connect/github';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}
