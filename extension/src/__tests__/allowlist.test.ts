import {
  DEFAULT_ALLOWLIST,
  isUrlAllowed,
  matchesPattern,
  getSitePatternFromUrl,
  getHostnameFromUrl,
} from '../allowlist';

describe('Allowlist Logic', () => {
  describe('DEFAULT_ALLOWLIST', () => {
    it('contains GreenPay internal domains only and no external pages', () => {
      expect(DEFAULT_ALLOWLIST.length).toBeGreaterThan(0);
      DEFAULT_ALLOWLIST.forEach((pattern) => {
        expect(pattern).toMatch(/greenpay\.(io|app)/);
      });
      // Verify common external domains are not in default
      expect(DEFAULT_ALLOWLIST).not.toContain('google.com/*');
      expect(DEFAULT_ALLOWLIST).not.toContain('github.com/*');
      expect(DEFAULT_ALLOWLIST).not.toContain('wikipedia.org/*');
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
      expect(isUrlAllowed('https://greenpay.io/', DEFAULT_ALLOWLIST)).toBe(true);
      expect(isUrlAllowed('https://greenpay.io/projects/abc-123', DEFAULT_ALLOWLIST)).toBe(true);
      expect(isUrlAllowed('https://greenpay.app/explore', DEFAULT_ALLOWLIST)).toBe(true);
      expect(isUrlAllowed('https://staging.greenpay.app/test', DEFAULT_ALLOWLIST)).toBe(true);
    });

    it('returns true for user-added sites in allowlist', () => {
      const customAllowlist = [...DEFAULT_ALLOWLIST, 'user-site.org/*', 'eco-fund.com'];

      expect(isUrlAllowed('https://user-site.org/donate', customAllowlist)).toBe(true);
      expect(isUrlAllowed('http://eco-fund.com/project/1', customAllowlist)).toBe(true);
      expect(isUrlAllowed('https://other-site.com', customAllowlist)).toBe(false);
    });

    it('handles wildcard subdomains when configured', () => {
      const allowlistWithWildcard = ['*.greenpay.io/*', '*.user-partner.com/*'];

      expect(isUrlAllowed('https://sub.greenpay.io/page', allowlistWithWildcard)).toBe(true);
      expect(isUrlAllowed('https://nested.sub.greenpay.io/page', allowlistWithWildcard)).toBe(true);
      expect(isUrlAllowed('https://greenpay.io/page', allowlistWithWildcard)).toBe(true);
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
