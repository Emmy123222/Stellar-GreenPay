export const DEFAULT_ALLOWLIST: string[] = [
  'greenpay.io/*',
  'https://greenpay.io/*',
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

/**
 * Matches a single pattern against a parsed URL.
 *
 * Supported pattern formats:
 * - Scheme + Host + Path: `https://greenpay.io/*`, `http://*.example.com/donate/*`, `*://*.greenpay.app/*`
 * - Host + Path: `greenpay.io/*`, `*.example.com/*`, `example.com/checkout`
 * - Host only: `greenpay.io`, `example.com`, `*.example.com`
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
