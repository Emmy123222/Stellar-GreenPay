# Bridging USDC to Stellar (`/bridge`)

This document explains what the `/bridge` page does, why it exists in GreenPay, and — just as importantly — what it does **not** do.

---

## The problem it solves

GreenPay donations settle on **Stellar**, in Stellar-native assets (XLM, or Stellar USDC). Most people, however, already hold USDC on **Ethereum** or **Polygon**, where they use it for DeFi, payroll, or card spending.

Asking those donors to "go buy XLM on an exchange first" is a real drop-off point. The bridge removes that step: the USDC a donor already owns becomes Stellar-native USDC they can donate directly.

```
  Donor holds USDC on Ethereum
              |
              |  Circle CCTP (burn on source, mint on destination)
              v
  Donor holds native USDC on Stellar
              |
              |  recordDonation() -> project wallet
              v
  Climate project is funded
```

---

## Why Circle CCTP

GreenPay uses Circle's **Cross-Chain Transfer Protocol (CCTP)**, the protocol operated by the issuer of USDC itself. The properties that matter for a donation platform:

| Property | Why it matters here |
|---|---|
| **Burn and mint, not wrapping** | No wrapped/bridged token exists to depeg, and no liquidity pool can be drained against donors. |
| **1:1, no bridge fee** | The amount burned on the source chain equals the amount minted on Stellar, so the donation value is not eroded in transit. |
| **No operator custody** | Funds are never held by a bridge operator, so there is no escrow account to be compromised or to be tempted to move. |
| **Permissionless** | The route does not depend on a GreenPay-operated service staying solvent or online. |

Because GreenPay is not the party moving the funds, the platform's custody and bridge risk are effectively zero. The trade-off is that GreenPay also has no on-chain visibility into the transfer — see [Known limitations](#known-limitations).

Reference: [Circle's CCTP documentation](https://developers.circle.com/stablecoins/cctp-getting-started).

---

## What the page does

Source: `frontend/pages/bridge.tsx`. The flow is four steps, and it is presented to the user in that order.

1. **Read the EVM USDC balance (read-only).**
   The page issues a single `eth_call` to the USDC contract's `balanceOf(address)` — selector `0x70a08231` — through the injected `window.ethereum` provider. No approval, no spend, no signature is requested for this step. Contract addresses used:

   | Source chain | USDC contract |
   |---|---|
   | Ethereum Mainnet | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
   | Polygon | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |

   USDC has 6 decimals, so the returned `uint256` is scaled down by `1e6` before display.

2. **Read the connected Stellar address.**
   Via `@stellar/freighter-api`'s `getAddress()`. This becomes the destination in step 3. The bridge button stays disabled until this resolves, because a transfer with no destination is unrecoverable.

3. **Hand off to Circle.**
   The page opens `https://bridge.circle.com` in a new tab with the destination, source chain, and token pre-filled as query parameters:

   ```
   https://bridge.circle.com
     ?destination=<Stellar address>
     &sourceChain=ethereum|polygon
     &destinationChain=stellar
     &token=USDC
   ```

   The approval and the actual burn/mint happen in Circle's interface. GreenPay holds no keys and signs nothing.

4. **Optionally record the donation.**
   Once the USDC has actually landed in the donor's Stellar wallet, the donor picks a project and an amount, and the page posts it to `POST /api/donations` with `currency: "USDC"`. This reuses the standard donation endpoint — the bridge adds no donation-specific backend surface.

---

## What the page explicitly does not do

- **It is not a fiat on/off-ramp.** There is no bank card, bank transfer, or cash-out option. This flow moves crypto the donor *already* controls. Buying USDC with fiat, or cashing out afterwards, is a **Stellar anchor** capability (SEP-24 deposit / withdrawal) and is **not built** — see [ROADMAP.md](../ROADMAP.md).
- **It never takes custody.** No funds are held by GreenPay at any point in the flow.
- **It does not verify that a transfer happened.** GreenPay cannot see the CCTP message, so the donation record it writes is an off-chain claim, not an on-chain proof.

---

## Known limitations

These are current trade-offs, not oversights:

- **No on-chain verification of the transfer.** `POST /api/donations` is called with a synthetic `transactionHash` (`bridge-<timestamp>`) because there is no real hash to report. The resulting donation is therefore **unverified**. Donors who want an on-chain, verifiable donation record should donate XLM (or Stellar USDC) directly from their Stellar wallet instead, where a real transaction hash exists.
- **Bridge history is browser-local.** Entries are stored in `localStorage` under `bridge_history` and are not synced to the backend, so history does not follow the donor across devices or browsers. It is a convenience list, not a ledger.
- **Polygon route is untested.** The Polygon option is selectable, but Circle's supported-domain list changes and the Polygon USDC contract above is only meaningful while Polygon remains a supported CCTP domain.
- **`eth_call` depends on a third-party wallet.** No wallet is bundled; the page relies on the user having MetaMask (or another injected EVM wallet) installed.

---

## Related roadmap work

The fiat on/off-ramp, i.e. what this page is **not**, is tracked in [ROADMAP.md](../ROADMAP.md). A SEP-24 implementation will additionally require backend work that does not exist today: an anchor integration, SEP-10 key authentication, and a `stellar.toml` / `/.well-known/stellar.toml` declaration. None of that is scaffolded in the backend today.

---

## Testing

The page is covered by `frontend/__tests__/pages/bridge.test.tsx`:

```bash
cd frontend
npm test -- __tests__/pages/bridge.test.tsx
```
