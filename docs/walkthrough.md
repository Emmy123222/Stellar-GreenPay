# 🎬 First Donation Walkthrough

A step-by-step guide to making your first climate donation on Stellar Testnet in under 10 minutes.

---

## Video Walkthrough

> **TODO:** Record a Loom or GIF of the full flow below and embed it here.
>
> ```
> [![Watch the walkthrough](https://cdn.loom.com/sessions/thumbnails/PLACEHOLDER.gif)](https://www.loom.com/share/PLACEHOLDER)
> ```
>
> Suggested recording scope (≈ 3–4 min):
> 1. Installing Freighter & switching to Testnet
> 2. Funding via Friendbot
> 3. Connecting wallet in the app
> 4. Selecting a project and submitting a donation
> 5. Verifying the transaction hash on Stellar Expert

---

## Step-by-Step

### 1. Install Freighter (2 min)

- Chrome: [install from Web Store](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk)
- Firefox: [install from Add-ons](https://addons.mozilla.org/en-US/firefox/addon/freighter-an-stellar-wallet/)
- Create a wallet and save your seed phrase.
- Open the extension → network dropdown → select **Testnet**.

### 2. Fund with Friendbot (30 sec)

Open in your browser (replace with your actual public key):

```
https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY
```

You'll receive 10,000 test XLM. Refresh Freighter to confirm the balance.

### 3. Start the App (1 min)

```bash
cd backend && npm run dev &
cd frontend && npm run dev
```

Open `http://localhost:3000`.

### 4. Connect Wallet & Donate (2 min)

1. Click **Connect Wallet** → approve the Freighter popup.
2. Pick a climate project from the list.
3. Enter a donation amount (e.g. `10`) and click **Donate**.
4. Freighter will show a transaction preview — click **Approve**.
5. A success banner displays your transaction hash.

### 5. Verify On-Chain (30 sec)

Paste the transaction hash into [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet/tx/YOUR_TX_HASH) to confirm it's recorded on-chain.

---

> Total time: **≈ 6 minutes** for a brand-new Stellar user.

---

## Embedding the Donation Widget

The `/widget/[projectId]` page is designed to be iframed on any third-party site.

### Security headers

Every response from `/widget/*` includes:

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `frame-ancestors *` | Permits framing by any origin (CSP3, all modern browsers) |
| `X-Frame-Options` | `ALLOWALL` | Legacy signal for older middleware / CDNs |

All other routes continue to send `X-Frame-Options: DENY` and `frame-ancestors 'none'`.

### Basic embed

Replace `PROJECT_ID` with the project's numeric or slug identifier:

```html
<iframe
  src="https://greenpay.app/widget/PROJECT_ID"
  width="360"
  height="420"
  style="border:none;border-radius:12px;"
  title="Donate to a climate project on GreenPay"
  loading="lazy"
></iframe>
```

### Customisation parameters

Append query parameters to tailor the widget appearance:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `theme` | `light` | `light` or `dark` colour scheme |
| `accent` | `#059669` | Hex colour for the header, progress bar, and button |
| `buttonText` | `Donate on GreenPay` | Label on the call-to-action button |
| `currency` | `XLM` | Display currency: `XLM` or `USDC` |

**Example — dark theme with custom accent:**

```html
<iframe
  src="https://greenpay.app/widget/PROJECT_ID?theme=dark&accent=%232563EB&buttonText=Support+This+Project&currency=XLM"
  width="360"
  height="420"
  style="border:none;border-radius:12px;"
  title="Donate to a climate project on GreenPay"
  loading="lazy"
></iframe>
```

> **Note:** URL-encode the `#` in hex colours as `%23` (e.g. `#2563EB` → `%232563EB`).

### Recommended `sandbox` attributes

If your host page already applies a `sandbox` attribute to its iframes, include at least the following permissions so the widget can function correctly:

```html
sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
```

- `allow-scripts` — required for React to hydrate the widget.
- `allow-same-origin` — required for the widget to call the GreenPay API.
- `allow-popups` + `allow-popups-to-escape-sandbox` — the **Donate** button opens the full project page in a new tab; without these the popup is silently blocked.
