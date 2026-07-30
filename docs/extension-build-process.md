# Extension Build Process

This document describes the build process for the GreenPay Companion browser extension for both Chrome Web Store and Firefox Add-ons.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Development Build](#development-build)
- [Production Build](#production-build)
- [Chrome-Specific Build](#chrome-specific-build)
- [Firefox-Specific Build](#firefox-specific-build)
- [Store Submission](#store-submission)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Node.js** (v18 or higher)
- **npm** (comes with Node.js)
- **Git** (for version control)

### Installation

1. Navigate to the extension directory:
   ```bash
   cd extension
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Project Structure

```
extension/
├── src/                      # TypeScript source files
│   ├── popup.ts             # Extension popup logic
│   ├── settings.ts          # Settings page logic
│   └── content-script.ts    # Content script for web pages
├── manifest.json            # Chrome extension manifest
├── manifest.firefox.json     # Firefox extension manifest
├── popup.html               # Popup HTML
├── popup.css                # Popup styles
├── settings.html            # Settings page HTML
├── webpack.config.js        # Webpack build configuration
├── tsconfig.json            # TypeScript configuration
├── package.json             # Node dependencies and scripts
└── store-assets/            # Store listing assets
    ├── icon-128.png
    ├── promo-tile-440x280.png
    └── screenshot-1280x800.png
```

## Development Build

For development with hot-reloading:

```bash
npm run dev
```

This command:
- Runs webpack in watch mode
- Automatically rebuilds when source files change
- Outputs to `dist/` directory
- Includes source maps for debugging

The development build is **not** optimized for production use.

## Production Build

For production builds suitable for store submission:

```bash
npm run build
```

This command:
- Runs webpack in production mode
- Minifies JavaScript output
- Generates source maps
- Cleans the output directory before building
- Outputs to `dist/` directory

### Build Output

The production build generates the following files in `dist/`:
- `popup.js` - Minified popup logic
- `settings.js` - Minified settings logic
- `content-script.js` - Minified content script
- `popup.js.map` - Source map for popup
- `settings.js.map` - Source map for settings
- `content-script.js.map` - Source map for content script

## Chrome-Specific Build

### Chrome Build Process

1. **Build the extension:**
   ```bash
   npm run build
   ```

2. **Copy static files to dist:**
   ```bash
   cp manifest.json dist/
   cp popup.html dist/
   cp popup.css dist/
   cp settings.html dist/
   ```

3. **Create distribution package:**
   ```bash
   cd dist
   zip -r ../greenpay-extension.zip .
   cd ..
   ```

### Chrome Manifest Differences

The Chrome manifest (`manifest.json`) uses:
- `manifest_version: 3`
- `action` instead of `browser_action`
- Host permissions restricted to GreenPay domains only
- Content scripts only run on GreenPay domains

### Chrome Testing

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right)
3. Click "Load unpacked"
4. Select the `dist/` directory
5. The extension will appear in your extensions list

## Firefox-Specific Build

### Firefox Build Process

Firefox requires a separate build due to manifest differences:

1. **Modify webpack config for Firefox output:**
   ```bash
   # Temporarily update webpack.config.js to output to dist-firefox/
   # Change line 13 from: path: path.resolve(__dirname, 'dist')
   # To: path: path.resolve(__dirname, 'dist-firefox')
   ```

2. **Build for Firefox:**
   ```bash
   npm run build
   ```

3. **Copy Firefox-specific files:**
   ```bash
   cp manifest.firefox.json dist-firefox/manifest.json
   cp popup.html dist-firefox/
   cp popup.css dist-firefox/
   cp settings.html dist-firefox/
   ```

4. **Create distribution package:**
   ```bash
   cd dist-firefox
   zip -r ../greenpay-extension-firefox.zip .
   cd ..
   ```

5. **Restore webpack config:**
   ```bash
   # Revert webpack.config.js to output to dist/
   ```

### Firefox Manifest Differences

The Firefox manifest (`manifest.firefox.json`) uses:
- `manifest_version: 3`
- `browser_action` (Firefox compatibility)
- `<all_urls>` host permissions (broader access)
- Content scripts run on all URLs
- `browser_specific_settings` with Firefox-specific ID
- Minimum Firefox version: 120.0

### Firefox Testing

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select `dist-firefox/manifest.json`
5. The extension will be installed temporarily

## Store Submission

### Chrome Web Store

See [PUBLISH.md](../extension/PUBLISH.md) for detailed Chrome Web Store submission instructions.

**Quick summary:**
1. Build the extension (see Chrome-Specific Build)
2. Create developer account at Chrome Web Store ($5 fee)
3. Upload `greenpay-extension.zip`
4. Add store assets from `store-assets/`
5. Provide permissions justification
6. Submit for review

### Firefox Add-ons

1. **Build the extension** (see Firefox-Specific Build)
2. **Create developer account** at https://addons.mozilla.org/
3. **Upload package:**
   - Navigate to Developer Hub
   - Click "Submit a New Add-on"
   - Upload `greenpay-extension-firefox.zip`
4. **Add store assets:**
   - Use same assets as Chrome from `store-assets/`
   - Firefox may require additional sizes
5. **Provide permissions justification:**
   - Explain `<all_urls>` permission for content script
   - Describe how extension detects Stellar addresses
6. **Submit for review:**
   - Firefox review typically takes 1-3 days
   - May require additional verification

## Troubleshooting

### Build Issues

**Problem:** Build fails with TypeScript errors
```
Solution: Ensure TypeScript is properly configured and all imports are valid.
Check tsconfig.json for compiler options.
```

**Problem:** Webpack cannot resolve modules
```
Solution: Verify all dependencies are installed with `npm install`.
Check webpack.config.js resolve configuration.
```

**Problem:** Build succeeds but extension doesn't load
```
Solution: 
- Verify manifest.json is valid JSON
- Check that all referenced files exist in dist/
- Ensure manifest version matches browser requirements
```

### Chrome-Specific Issues

**Problem:** Extension rejected for permissions
```
Solution: Review host_permissions in manifest.json.
Ensure justification is provided for each permission.
```

**Problem:** Content script not injecting
```
Solution: Verify matches patterns in content_scripts section.
Check that dist/content-script.js exists and is valid.
```

### Firefox-Specific Issues

**Problem:** Extension rejected for manifest version
```
Solution: Ensure manifest_version is 3.
Firefox requires manifest v3 for new submissions.
```

**Problem:** browser_specific_settings validation error
```
Solution: Verify the gecko ID is unique and follows format: name@domain
Check strict_min_version is compatible with target Firefox versions.
```

### General Issues

**Problem:** Zip file too large for store upload
```
Solution: Ensure production build is minified.
Exclude unnecessary files from the zip.
Check that source maps are not included in store submission.
```

**Problem:** Extension works in testing but fails store review
```
Solution: 
- Test in clean browser profile
- Verify all store assets meet specifications
- Ensure privacy policy URL is accessible
- Check that description matches actual functionality
```

## Versioning

When releasing a new version:

1. **Update version numbers:**
   - Update `version` in `manifest.json`
   - Update `version` in `manifest.firefox.json`
   - Update `version` in `package.json`

2. **Build for both platforms:**
   - Follow Chrome build process
   - Follow Firefox build process

3. **Create versioned packages:**
   ```bash
   # Chrome
   cd dist
   zip -r ../greenpay-extension-v1.0.1.zip .
   cd ..
   
   # Firefox
   cd dist-firefox
   zip -r ../greenpay-extension-firefox-v1.0.1.zip .
   cd ..
   ```

4. **Submit to stores:**
   - Upload Chrome package to Chrome Web Store
   - Upload Firefox package to Firefox Add-ons

5. **Tag release in Git:**
   ```bash
   git tag -a extension-v1.0.1 -m "Extension release v1.0.1"
   git push origin extension-v1.0.1
   ```

## Additional Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/mv3/)
- [Firefox Extension Documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [WebExtension API Reference](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
