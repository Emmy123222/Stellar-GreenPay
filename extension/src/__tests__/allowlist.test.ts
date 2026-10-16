import {
  DEFAULT_ALLOWLIST,
  isUrlAllowed,
  matchesPattern,
  getSitePatternFromUrl,
  getHostnameFromUrl,
  isValidAllowlistPattern,
} from '../allowlist';

// Jest resolves JSON requires and hands them to `require`; the extension build
// never compiles test files, so the browser tsconfig does not need node types.
declare const require: (id: string) => unknown;

describe('Allowlist Logic', () => {
  describe('isValidAllowlistPattern', () => {
    it('accepts supported host, scheme, wildcard, and path forms', () => {
      expect(isValidAllowlistPattern('example.com/*')).toBe(true);
      expect(isValidAllowlistPattern('https://*.example.com/donate/*')).toBe(true);
      expect(isValidAllowlistPattern('*://greenpay.app/projects/*')).toBe(true);
    });

    it('rejects malformed or unsafe entries', () => {
      expect(isValidAllowlistPattern('')).toBe(false);
      expect(isValidAllowlistPattern('https://bad host')).toBe(false);
      expect(isValidAllowlistPattern('javascript:alert(1)')).toBe(false);
      expect(isValidAllowlistPattern('*://*/*')).toBe(false);
    });
  });

  describe('DEFAULT_ALLOWLIST', () => {
    it('contains GreenPay internal domains only and no external pages', () => {
      expect(DEFAULT_ALLOWLIST.length).toBeGreaterThan(0);
      DEFAULT_ALLOWLIST.forEach((pattern) => {
        expect(pattern).toMatch(/greenpay\.app/);
      });
      // Verify common external domains are not in default
      expect(DEFAULT_ALLOWLIST).not.toContain('google.com/*');
      expect(DEFAULT_ALLOWLIST).not.toContain('github.com/*');
      expect(DEFAULT_ALLOWLIST).not.toContain('wikipedia.org/*');
    });

    it('agrees with the host permissions of both manifests', () => {
      // A default that no host permission covers can never inject: the settings
      // UI would advertise a site the widget cannot run on.
      for (const manifestFile of ['manifest.json', 'manifest.firefox.json']) {
        const manifest = require(`../../${manifestFile}`) as { host_permissions: string[] };
        // `<all_urls>` is deliberately ignored: it is slated for removal (#1645),
        // so every default must be backed by an explicit host permission.
        const explicitHosts = manifest.host_permissions
          .filter((permission) => permission !== '<all_urls>')
          .map((permission) => new URL(permission.replace('*', 'wildcard')).host)
          .filter((host) => !host.startsWith('api.') && !host.startsWith('horizon'));

        for (const pattern of DEFAULT_ALLOWLIST) {
          const host = new URL(pattern.replace('*', 'wildcard')).host;
          expect(explicitHosts).toContain(host);
          expect(host).not.toContain('greenpay.io');
        }
      }
    });
  });

  describe('isUrlAllowed', () => {
    it('returns false for non-allowlisted external pages by default', () => {
      expect(isUrlAllowed('https://example.com', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('https://wikipedia.org/wiki/Stellar', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('https://github.com/stellar', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('http://my-blog.com', DEFAULT_ALLOWLIST)).toBe(false);
    });

    it('returns false for deceptive prefix/suffix domains', () => {
      expect(isUrlAllowed('https://evil-greenpay.io', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('https://greenpay.io.attacker.com', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('https://staging-greenpay.app.fake.com', DEFAULT_ALLOWLIST)).toBe(false);
    });

    it('returns true for default allowlisted domains', () => {
      expect(isUrlAllowed('https://greenpay.app/', DEFAULT_ALLOWLIST)).toBe(true);
      expect(isUrlAllowed('https://greenpay.app/projects/abc-123', DEFAULT_ALLOWLIST)).toBe(true);
      expect(isUrlAllowed('https://staging.greenpay.app/test', DEFAULT_ALLOWLIST)).toBe(true);
    });

    it('returns true for user-added sites in allowlist', () => {
      const customAllowlist = [...DEFAULT_ALLOWLIST, 'user-site.org/*', 'eco-fund.com'];

      expect(isUrlAllowed('https://user-site.org/donate', customAllowlist)).toBe(true);
      expect(isUrlAllowed('http://eco-fund.com/project/1', customAllowlist)).toBe(true);
      expect(isUrlAllowed('https://other-site.com', customAllowlist)).toBe(false);
    });

    it('handles wildcard subdomains when configured', () => {
      const allowlistWithWildcard = ['*.greenpay.app/*', '*.user-partner.com/*'];

      expect(isUrlAllowed('https://sub.greenpay.app/page', allowlistWithWildcard)).toBe(true);
      expect(isUrlAllowed('https://nested.sub.greenpay.app/page', allowlistWithWildcard)).toBe(true);
      expect(isUrlAllowed('https://greenpay.app/page', allowlistWithWildcard)).toBe(true);
      expect(isUrlAllowed('https://partner.user-partner.com/donate', allowlistWithWildcard)).toBe(true);
      expect(isUrlAllowed('https://notpartner.com', allowlistWithWildcard)).toBe(false);
    });

    it('returns false for invalid or non-http(s) URLs', () => {
      expect(isUrlAllowed('chrome://extensions', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('moz-extension://abcdef/popup.html', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('about:blank', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('javascript:void(0)', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('not-a-url', DEFAULT_ALLOWLIST)).toBe(false);
      expect(isUrlAllowed('', DEFAULT_ALLOWLIST)).toBe(false);
    });

    it('returns false when allowlist is empty', () => {
      expect(isUrlAllowed('https://greenpay.io', [])).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('matches exact host and wildcard path', () => {
      const url = new URL('https://example.com/checkout/step1');
      expect(matchesPattern('example.com/*', url)).toBe(true);
      expect(matchesPattern('example.com', url)).toBe(true);
      expect(matchesPattern('https://example.com/*', url)).toBe(true);
      expect(matchesPattern('http://example.com/*', url)).toBe(false); // wrong scheme
    });

    it('matches specific path prefixes', () => {
      const donateUrl = new URL('https://example.com/donate/campaign1');
      const blogUrl = new URL('https://example.com/blog/post1');

      expect(matchesPattern('example.com/donate/*', donateUrl)).toBe(true);
      expect(matchesPattern('example.com/donate/*', blogUrl)).toBe(false);
    });

    it('handles any scheme (*://)', () => {
      const httpsUrl = new URL('https://example.com/page');
      const httpUrl = new URL('http://example.com/page');

      expect(matchesPattern('*://example.com/*', httpsUrl)).toBe(true);
      expect(matchesPattern('*://example.com/*', httpUrl)).toBe(true);
    });
  });

  describe('getSitePatternFromUrl & getHostnameFromUrl', () => {
    it('extracts site pattern from standard URL', () => {
      expect(getSitePatternFromUrl('https://example.com/some/path?query=1')).toBe('example.com/*');
      expect(getSitePatternFromUrl('http://sub.domain.org:8080/')).toBe('sub.domain.org/*');
    });

    it('returns null for non-http(s) or invalid URLs', () => {
      expect(getSitePatternFromUrl('chrome://settings')).toBeNull();
      expect(getSitePatternFromUrl('about:blank')).toBeNull();
      expect(getSitePatternFromUrl('invalid-url')).toBeNull();
    });

    it('extracts hostname from valid URL', () => {
      expect(getHostnameFromUrl('https://example.com/test')).toBe('example.com');
      expect(getHostnameFromUrl('https://Staging.GreenPay.App/')).toBe('staging.greenpay.app');
      expect(getHostnameFromUrl('chrome://extensions')).toBeNull();
    });
  });
});
