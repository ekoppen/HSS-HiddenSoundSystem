// Attaches the stored session token to every same-origin fetch automatically.
// Without this, each of the ~100 fetch() calls scattered across the app would
// need to individually remember to read the token from localStorage and set
// the Authorization header — in practice only one call site ever did, which
// is exactly what let every mutating request through unauthenticated on the
// server side (server.ts fell back to treating any credential-less request
// as the default admin). Import this once, for its side effect, before
// anything else renders.
const TOKEN_KEY = 'hss_auth_token';
const originalFetch = window.fetch.bind(window);

// A plain startsWith('/') check treats a protocol-relative URL like
// "//evil.com/steal" as same-origin too — it also starts with a single "/".
// Browsers resolve that against the page's own protocol to a genuine
// cross-origin request, so that check would have attached the real bearer
// token to a request headed to evil.com. Resolving through URL() and
// comparing the actual origin is the only way to get this right for every
// case (relative paths, protocol-relative, absolute, different-origin).
function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return originalFetch(input, init);

  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!isSameOrigin(url)) return originalFetch(input, init);

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return originalFetch(input, { ...init, headers });
}) as typeof fetch;

export {};
