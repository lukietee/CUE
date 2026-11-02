/** Canonical entry URL shared by the dev launcher and Electron navigation guard. */
export function normalizeRendererEntryUrl(entry: string): string {
  const url = new URL(entry);
  if (url.username || url.password || url.search)
    throw new Error('Renderer entry must not contain credentials or query parameters.');
  if (url.protocol === 'http:') {
    // Development serves one document on IPv4 loopback. Do not allow arbitrary origins or paths.
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/')
      throw new Error('Development renderer must be the root document on 127.0.0.1.');
  } else if (url.protocol === 'file:') {
    if (url.host || !url.pathname.endsWith('/index.html'))
      throw new Error('Production renderer must be a local index.html file.');
  } else {
    throw new Error('Unsupported renderer entry protocol.');
  }
  url.hash = '';
  return url.href;
}

/** Allow refresh/hash navigation to the same document, never another route, query or origin. */
export function isAllowedRendererNavigation(target: string, entry: string): boolean {
  try {
    const allowed = normalizeRendererEntryUrl(entry);
    const url = new URL(target);
    if (url.username || url.password || url.search) return false;
    url.hash = '';
    return url.href === allowed;
  } catch {
    return false;
  }
}
