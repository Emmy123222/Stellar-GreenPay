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
