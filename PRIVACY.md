# Stellar GreenPay - Privacy Policy

**Last updated:** October 2026

Stellar GreenPay is an open-source, non-custodial climate donation platform built on the Stellar network. This policy explains what the **GreenPay Companion browser extension** (and the platform) stores and sends, in plain language. We minimize data collection: the extension works locally wherever it can, and never touches your private keys.

---

## 1. Non-Custodial Architecture

Stellar GreenPay does not hold, custody, or manage private keys or funds:

- Transactions are signed locally in your chosen Stellar wallet (e.g. Freighter).
- Your private keys and secret seeds never leave your browser or device.
- The extension requests no secrets and cannot read or move funds on its own — it only hands payment details to Freighter for you to approve.

---

## 2. What the Extension Stores Locally

All extension data is stored in your browser via the `chrome.storage` APIs. Nothing here is uploaded to GreenPay; it lives on your device (and `sync` follows your browser account if you are signed in).

**`storage.local` (on this device):**

- `pendingDonations` — the in-flight donations you have started: each entry keeps the **transaction hash**, **amount**, **destination address** you are paying, and a **created-at timestamp**. These are kept only until Horizon confirms/fails them or a 5-minute timeout passes, then they are dropped.
- `totalDonatedXLM` — your lifetime donation total, used only to render the toolbar badge.
- `pendingDonationProjectId` and `pendingDonationAddress` — short-lived handoff values used when you start a donation from a project page or a detected address; they are cleared once the flow completes.
- `onboarded` — a flag recording that you finished the first-run intro.

**`storage.sync` (your settings, synced across your signed-in browser):**

- `network` (`testnet` or `mainnet`), `backendUrl`, `defaultDonationAmount`, and `allowlist` — the list of sites on which the donation widget is allowed to appear.

**`storage.session` (only for the current browser session):**

- The connected Stellar **public address**, cached so the popup can repaint quickly. This is cleared when the browser session ends and is never a secret value.

---

## 3. What the Extension Sends, and To Whom

- **GreenPay backend API** (default `https://api.stellar-greenpay.app`, configurable via the `backendUrl` setting). The extension makes **read** requests only — fetching projects (`GET /api/projects`), a single project (`GET /api/projects/:id`), and a donor profile (`GET /api/profiles/:publicKey`). These send a search term, a project id, or your wallet's **public** address, which is required to look up that data. Your public address is already visible on the blockchain.
- **Stellar Horizon** (testnet or mainnet, per your `network` setting). The extension calls `GET /transactions/:hash` to check whether a donation you started has been confirmed. Only the transaction hash is sent; the extension only reads public ledger state.
- **IPFS gateways / third-party nodes** may be reached to retrieve project documents and impact certificates. Those services have their own policies.

The extension never transmits your secret key, seed phrase, or any credential.

---

## 4. Browsing Activity

- The donation widget is injected **only on sites in your `allowlist`** (defaults: `greenpay.app` and `staging.greenpay.app`; you can add your own).
- The content script can recognize Stellar public-key-formatted text on the page you are viewing, but it does this **locally in your browser**. It does **not** upload, log, or transmit the pages you visit or their contents.
- **No browsing history is collected or sent** to GreenPay or any third party beyond the specific resources of the allowlisted site needed to render the widget. There are no analytics or tracking beacons in the extension.
- Requested permissions and why: `storage` (the settings above), `activeTab` + `scripting` (inject the widget / act on the page you choose), `contextMenus` (a "Donate with GreenPay" action on an address you select), `alarms` (periodically re-check pending donations against Horizon), and broad host access so **you** can allowlist your own sites — the widget still appears only where you have enabled it.

---

## 5. Public Blockchain Data

When you complete a donation, your public wallet address, the amount, the recipient, and the timestamp are broadcast to and permanently recorded on the public Stellar ledger. This is inherent to blockchain technology and is outside the extension's control.

---

## 6. Updates to This Policy

We may update this Privacy Policy to reflect changes in functionality or applicable law. Changes take effect when this document is updated in the repository.

---

## 7. Contact & Questions

If you have questions about this privacy policy or how data is handled, open an issue in our repository:
[https://github.com/Emmy123222/Stellar-GreenPay/issues](https://github.com/Emmy123222/Stellar-GreenPay/issues)
