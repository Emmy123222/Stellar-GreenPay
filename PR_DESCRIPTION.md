feat: add context menu item to donate to project, fix inline address click flow via background service worker

## Summary
This PR adds a right-click context menu item ("Donate to this GreenPay project") that appears dynamically when a user right-clicks on a page containing a GreenPay project ID (detected via URL or the new `<meta name="greenpay:project:id">` tag). Clicking the context menu item opens the extension popup, fetches the project details, and pre-fills the donation form automatically.

Additionally, this PR fixes a dormant feature where clicking a highlighted inline Stellar address in the browser did not work because the background script to handle `openDonatePopup` was missing. Both features now share a robust background service worker.

Key changes:
- Added `greenpay:project:id` meta tag to `frontend/pages/projects/[id].tsx`.
- Registered `background.ts` as a service worker in `manifest.json` and `manifest.firefox.json` with the `contextMenus` permission.
- Updated `content-script.ts` to detect the project ID dynamically on load and via a `MutationObserver`/`popstate` to support Next.js SPA routing, notifying the background script of context changes.
- Implemented `popup.ts` to consume the pending donation context from `chrome.storage.local` and auto-fill the destination `walletAddress` and project name.

## Type
- [x] Bug fix
- [x] New feature
- [ ] Documentation
- [ ] Refactor
- [ ] Smart contract change

## Related Issue
Closes #492

## Testing
- [x] Tested locally on Testnet
- [x] No TypeScript / Rust errors
- [ ] Docs updated if needed

## Screenshots (if UI change)
<!-- Add screenshots here if applicable -->
