# Chrome Web Store Submission Guide

This document outlines the steps to publish the GreenPay Companion extension to the Chrome Web Store.

## Prerequisites

- Chrome Web Store Developer account (cost: $5 one-time fee)
- All store assets committed to `extension/store-assets/`
- Built extension (run `npm run build` to generate `dist/` folder)

## Assets Required

All assets must be committed to `extension/store-assets/`:

1. **Icon (128x128 PNG)**
   - File: `extension/store-assets/icon-128.png`
   - Clear, recognizable branding
   - Solid background recommended

2. **Promotional Tile (440x280 PNG)**
   - File: `extension/store-assets/promo-tile-440x280.png`
   - Showcases the extension's main value proposition
   - Used on store listing

3. **Screenshot (1280x800 PNG)**
   - File: `extension/store-assets/screenshot-1280x800.png`
   - Demonstrates the extension in action
   - Shows the popup interface

## Store Listing Details

### Summary (140 characters max)
"Donate to sustainable projects worldwide via Stellar. One-click climate action."

### Full Description
"GreenPay Companion makes climate action effortless. Discover vetted sustainable projects and donate via Stellar blockchain in seconds.

Key Features:
- Detect Stellar addresses on any web page and donate instantly
- Browse curated climate and conservation projects
- Track your impact with transparent on-chain transactions
- Support verified initiatives from ocean cleanup to reforestation

Built on Stellar for transparent, fast, and low-cost donations."

### Privacy Policy (required for store review)

Both the Chrome Web Store and Firefox Add-ons require a **working privacy policy** for extensions that request `storage`, `activeTab`, `scripting`, and host access.

- `manifest.json` sets `privacy_policy_url` to the repo-root policy:
  `https://github.com/Emmy123222/Stellar-GreenPay/blob/main/PRIVACY.md`
- That path is backed by [`../PRIVACY.md`](../PRIVACY.md), which documents exactly what the extension stores locally (allowlist, `pendingDonations`, etc.), what it sends to the GreenPay backend / Stellar Horizon, and the "no browsing history" guarantee.

**Pre-upload checklist:**

- [ ] [`../PRIVACY.md`](../PRIVACY.md) exists at the repo root and matches the data actually touched in `extension/src/`
- [ ] `privacy_policy_url` in `manifest.json` (and `manifest.firefox.json`) points to the live PRIVACY.md URL and returns **200** (not 404)
- [ ] Privacy policy text describes local storage, backend/Horizon calls, and the absence of browsing-history collection
- [ ] Store console "Privacy" section: single-purpose statement + no remote-data-sale attestation matches PRIVACY.md

## Submission Steps

1. **Create Developer Account**
   - Visit https://chrome.google.com/webstore/category/extensions
   - Click 'Publish extensions'
   - Complete KYC (Know Your Customer) verification

2. **Upload Extension**
   - Use Chrome Web Store Developer Console
   - Upload `greenpay-extension.zip` from `extension/` directory
   - Ensure `manifest.json` includes all required permissions

3. **Add Store Assets**
   - Upload 128x128 icon
   - Upload 440x280 promotional tile
   - Upload 1280x800 screenshot
   - Complete store listing text

4. **Set Permissions**
   - Justify `<all_urls>` host permission:
     "The extension injects a content script to detect Stellar addresses (format: GXXXXXXX) on any webpage and offer users the ability to donate to those addresses via our platform."

5. **Submit for Review**
   - Review all policy requirements
   - Submit for automatic and manual review
   - Chrome Web Store team reviews within 24-72 hours

## Review Policy Compliance

- No malware or unsafe behavior
- No content scripts that modify user experience without consent (our tooltip is an opt-in donation feature)
- Clear privacy policy linked in manifest — see repo-root [`../PRIVACY.md`](../PRIVACY.md) (referenced by `privacy_policy_url`); verify it is checked in the pre-upload checklist above
- No data collection beyond user donations

## Firefox Add-ons

`manifest.firefox.json` is the Firefox variant of the manifest. It parses as
strict JSON and passes the same isolated-manifest `web-ext lint` check that CI
runs (`npx web-ext lint --source-dir <tmp> --self-hosted`). It intentionally
differs from `manifest.json` only in:

- `browser_specific_settings.gecko` (add-on ID and `strict_min_version`)
- `background.scripts: ["dist-firefox/background.js"]` instead of Chrome's
  `background.service_worker` + `"type": "module"` (Firefox does not support
  service workers for extension backgrounds)
- content script paths under `dist-firefox/` instead of `dist/`

To package for Firefox, build the bundles into `dist-firefox/` (e.g. run
webpack with its output directory set to `dist-firefox`, or copy the `dist/`
output there), place `manifest.firefox.json` as `manifest.json` in the packaged
directory, then run `npx web-ext lint --source-dir <pkg>` followed by
`npx web-ext build --source-dir <pkg>` and submit the resulting zip to
https://addons.mozilla.org/

Known remaining `web-ext lint` output for this manifest (documented, not
blocking):

- Warning `MISSING_DATA_COLLECTION_PERMISSIONS` — AMO will require
  `browser_specific_settings.gecko.data_collection_permissions` for new
  versions; add it before the first store submission.
- When linting the manifest alone in a temp directory (as CI does), errors
  `MANIFEST_BACKGROUND_FILE_NOT_FOUND`,
  `MANIFEST_CONTENT_SCRIPT_FILE_NOT_FOUND`, and `MANIFEST_ICON_NOT_FOUND` are
  expected because `dist-firefox/` and `icons/` are not copied into the temp
  directory; they disappear when linting the packaged build.

Submit to:
https://addons.mozilla.org/

Similar process, but additional developer verification required.

## Troubleshooting

- **Upload fails**: Verify `manifest.json` is valid JSON with all required fields
- **Store listing rejected**: Check policy compliance, particularly around permissions justification
- **Assets rejected**: Ensure correct dimensions (128x128, 440x280, 1280x800) and PNG format

## Versioning

When updating the extension:
1. Increment version in `manifest.json` and `manifest.firefox.json`
2. Run `npm run build` to regenerate `dist/`
3. Create `greenpay-extension-v1.x.x.zip` for release
4. Submit new version through Chrome Web Store Developer Console
