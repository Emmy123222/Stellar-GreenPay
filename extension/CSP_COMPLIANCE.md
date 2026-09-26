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
```
webpack build
├── Encounters: import './widget.css'
├── style-loader converts CSS to JS
├── CSS is injected into content-script.js bundle
└── <style> tag injected at runtime
```

### Runtime
```
Content Script Loads
├── CSS already embedded in JS bundle
├── style-loader injects <style> tag into document
├── Styles apply via CSS classes (not inline style attributes)
└── CSP 'style-src self' allows inline <style> tags
```

## CSP Compliance

### Allowed by `style-src 'self'`:
✓ Inline `<style>` tags  
✓ CSS classes  
✓ CSS animations  

### Blocked by `style-src 'self'`:
✗ External stylesheets (cdn.example.com)  
✗ `style` attribute with external URLs  

## Testing

### Manual Test
1. Open `test-csp.html` in Chrome
2. Open DevTools Console (F12)
3. Verify no CSP violations
4. Check that Stellar addresses are highlighted
5. Hover to see tooltip appear

### Automated Test
Run: `npm run build`

Then inspect the generated `dist/content-script.js`:
- Should contain embedded CSS
- No external stylesheet references
- Should NOT contain `<link>` tags to external CDNs

## Dependencies
- `style-loader@^3.3.3` - Injects CSS as inline `<style>` tags
- `css-loader@^6.8.1` - Parses and transforms CSS

## Verification Commands

```bash
# Build the extension
npm run build

# Check that content-script bundle includes inline styles
grep -o 'greenpay-address' dist/content-script.js

# Should contain CSS, not <link> tags
file dist/content-script.js
```

## Browser Support
- Chrome/Chromium: ✓ Full support
- Firefox: ✓ Full support (with content_scripts)
- Safari: ✓ Full support (with inline styles)

## Future Considerations
- Consider shadow DOM if dynamic widget injection is needed
- Shadow DOM with `adoptedStyleSheets` for encapsulation
- Service Worker style bundling if required
