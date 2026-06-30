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
- Clear privacy policy linked in manifest
- No data collection beyond user donations

## Firefox Add-ons (Future)

For Firefox support, use `manifest.firefox.json` and submit to:
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
