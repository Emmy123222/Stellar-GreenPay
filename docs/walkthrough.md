# 🎬 First Donation Walkthrough

A step-by-step guide to making your first climate donation on Stellar Testnet in under 10 minutes.

> **Last verified against API v1.3 — 2026-09-30**
>
> The code examples below were audited against the current API spec
> (`docs/openapi.yml`). If an example looks out of date, please open an issue.

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

## Verify via the API (optional)

The examples below use the current API response shapes. All endpoints are
served under the `/api/v1` prefix (issue #204).

### Record a donation

`POST /api/donations`

Request:

```json
{
  "projectId": "c4ac10b-58cc-4372-a567-0e02b2c3d479",
  "donorAddress": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "amountXLM": "100",
  "currency": "XLM",
  "message": "For the planet!",
  "transactionHash": "abc123…"
}
```

Response (`201 Created`):

```json
{
  "success": true,
  "data": {
    "id": "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
    "projectId": "c4ac10b-58cc-4372-a567-0e02b2c3d479",
    "donorAddress": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "amount": "100",
    "currency": "XLM",
    "message": "For the planet!",
    "transactionHash": "abc123…",
    "amountXLM": "100.0000000",
    "co2OffsetKg": 500,
    "createdAt": "2026-09-30T12:00:00.000Z"
  }
}
```

> **Note:** the donation id is `data.id` (not `donation_id`), and the
> amount in XLM is `data.amountXLM` (not `amount_xlm`).

### Fetch a donor's history

`GET /api/donations/donor/:publicKey`

```bash
curl "http://localhost:4000/api/v1/donations/donor/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?limit=20"
```

Response:

```json
{
  "success": true,
  "data": [
    {
      "id": "8d9ac19b-52eb-42f7-80d9-19a88ba59e43",
      "projectId": "c4ac10b-58cc-4372-a567-0e02b2c3d479",
      "donorAddress": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "amountXLM": "100.0000000",
      "co2OffsetKg": 500,
      "transactionHash": "abc123…",
      "createdAt": "2026-09-30T12:00:00.000Z"
    }
  ],
  "has_more": false,
  "next_cursor": null,
  "total": 1
}
```

> **Note:** pagination uses `has_more` / `next_cursor` (not `hasNext` /
> `nextPage`), and the total count is `total` (not `count`).

---

> Total time: **≈ 6 minutes** for a brand-new Stellar user.
