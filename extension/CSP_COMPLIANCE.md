# GreenPay Widget - Content Security Policy Compliance

## Issue
The donation widget was broken on sites with strict CSP policies like `style-src 'self'`, which only allow stylesheets from the same origin. External CDN stylesheets were blocked, breaking the widget appearance.

## Solution
All widget styles are now bundled inline during the webpack build process using `style-loader` and `css-loader`.

### Changes Made

1. **Webpack Configuration** (`webpack.config.js`)
   - Added `style-loader` and `css-loader` to handle CSS imports
   - CSS is now injected inline into the bundle via `<style>` tags

2. **Widget Styles** (`src/widget.css`)
   - Extracted all widget styles to a dedicated CSS file
   - Includes styles for `.greenpay-address` highlights and `.greenpay-tooltip`
   - All animations defined inline

3. **Content Script** (`src/content-script.ts`)
   - Imports `widget.css` at the top
   - Removed all inline `style.cssText` assignments
   - Styles are now applied via CSS class names only

4. **Test Page** (`test-csp.html`)
   - Simulates a strict CSP environment: `style-src 'self'`
   - Tests widget rendering with inline-only styles
   - Validates no external stylesheet requests

## How It Works

### Build Time
```text
webpack build
├── Encounters: import './widget.css'
├── style-loader converts CSS to JS
├── CSS is injected into content-script.js bundle
└── <style> tag injected at runtime