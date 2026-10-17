/**
 * Sites the widget is enabled on out of the box.
 *
 * These are the canonical product hosts. Every entry here must also be covered
 * by an explicit host permission in `manifest.json` and `manifest.firefox.json`,
 * otherwise the content script can never inject on it — a default the settings
 * UI would offer but that can never work. `allowlist.test.ts` enforces that
 * agreement, so add new defaults to both manifests as well.
 */
export const DEFAULT_ALLOWLIST: string[] = [
  'https://greenpay.app/*',
  'https://staging.greenpay.app/*',
];

/**
 * Checks if a given URL matches any pattern in the allowlist.
 */
export function isUrlAllowed(urlStr: string, allowlist: string[]): boolean {
  if (!urlStr || !Array.isArray(allowlist) || allowlist.length === 0) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  // Only http and https protocols are supported for injection
  if (!['http:', 'https:'].includes(url.protocol.toLowerCase())) {
    return false;
  }

  return allowlist.some((pattern) => matchesPattern(pattern, url));
}

/** Validate a user-entered host/path allowlist pattern before saving it. */
export function isValidPattern(pattern: string): boolean {
  const value = pattern.trim();
  if (!value || /\s/.test(value)) return false;
  const match = value.match(/^(\*:\/\/|https?:\/\/)?([^/]+)(\/.*)?$/i);
  if (!match) return false;
  const [, scheme, host, path = "/*"] = match;
  if (scheme && !["*://", "http://", "https://"].includes(scheme.toLowerCase())) return false;
  if (host === "*" || host.includes("@") || host.includes(":") && !/^\[[0-9a-f:]+\](?::\d+)?$/i.test(host)) return false;
  const normalizedHost = host.startsWith("*.") ? host.slice(2) : host;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(normalizedHost)) return false;
  if (!/^\/[a-z0-9._~!$&'()+,;=:@%/*-]*$/i.test(path)) return false;
  try {
    new URL(`${scheme === "*://" ? "https://" : scheme || "https://"}${host.replace(/^\*\./, "wildcard.")}${path.replace(/\*/g, "wildcard")}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a user-entered allowlist pattern, or return null when it is invalid.
 *
 * Normalization rules (shown as hints in the settings UI):
 * - surrounding whitespace is removed
 * - the scheme and host are lower-cased (hosts are case-insensitive), while the
 *   path keeps its case because URL paths are case-sensitive
 * - a bare host, or a host followed by only `/`, becomes the site-wide
 *   `host/*` form so `Example.COM/` and `example.com/*` are the same entry
 * - a path ending in `/` is treated as a directory prefix and gains `*`
 *   (`example.com/donate/` → `example.com/donate/*`)
 */
export function normalizeAllowlistPattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  let scheme = '';
  let rest = trimmed;
  const schemeMatch = trimmed.match(/^(\*:\/\/|https?:\/\/)/i);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    rest = trimmed.slice(schemeMatch[1].length);
  }

  const slashIndex = rest.indexOf('/');
  const host = (slashIndex === -1 ? rest : rest.slice(0, slashIndex)).toLowerCase();
  let path = slashIndex === -1 ? '' : rest.slice(slashIndex);

  if (!path || path === '/') {
    path = '/*';
  } else if (path.endsWith('/')) {
    path += '*';
  }

  const normalized = `${scheme}${host}${path}`;
  return isValidPattern(normalized) ? normalized : null;
}

/**
 * Matches a single pattern against a parsed URL.
 *
 * Supported pattern formats:
 * - Scheme + Host + Path: `https://greenpay.app/*`, `http://*.example.com/donate/*`, `*://*.greenpay.app/*`
 * - Host + Path: `greenpay.app/*`, `*.example.com/*`, `example.com/checkout`
 * - Host only: `greenpay.app`, `example.com`, `*.example.com`
 */
export function matchesPattern(pattern: string, url: URL): boolean {
  if (!pattern || typeof pattern !== 'string') return false;

  const trimmed = pattern.trim().toLowerCase();
  if (!trimmed) return false;

  let schemeMatch: string | null = null;
  let rest = trimmed;

  if (rest.startsWith('*://')) {
    schemeMatch = '*';
    rest = rest.slice(4);
  } else if (rest.startsWith('https://')) {
    schemeMatch = 'https:';
    rest = rest.slice(8);
  } else if (rest.startsWith('http://')) {
    schemeMatch = 'http:';
    rest = rest.slice(7);
  }

  // If scheme was explicitly specified, it must match
  if (schemeMatch && schemeMatch !== '*' && schemeMatch !== url.protocol.toLowerCase()) {
    return false;
  }

  const firstSlash = rest.indexOf('/');
  const hostPart = firstSlash === -1 ? rest : rest.slice(0, firstSlash);
  const pathPart = firstSlash === -1 ? '*' : rest.slice(firstSlash);

  // Host matching
  const currentHost = url.hostname.toLowerCase();
  if (hostPart === '*') {
    // Matches any host
  } else if (hostPart.startsWith('*.')) {
    const baseDomain = hostPart.slice(2);
    if (currentHost !== baseDomain && !currentHost.endsWith('.' + baseDomain)) {
      return false;
    }
  } else {
    if (currentHost !== hostPart) {
      return false;
    }
  }

  // Path matching
  if (pathPart === '*' || pathPart === '/*' || pathPart === '') {
    return true;
  }

  // Convert wildcard pattern to regex
  const pathRegexStr =
    '^' +
    pathPart
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') +
    '$';

  try {
    const pathRegex = new RegExp(pathRegexStr);
    return pathRegex.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Extracts a site allowlist pattern (e.g. `example.com/*`) from a full URL.
 * Returns null if the URL is invalid or not an HTTP(S) URL.
 */
export function getSitePatternFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol.toLowerCase())) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (!host) return null;
    return `${host}/*`;
  } catch {
    return null;
  }
}

/**
 * Extracts the hostname from a URL string, or null if invalid.
 */
export function getHostnameFromUrl(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol.toLowerCase())) {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}
