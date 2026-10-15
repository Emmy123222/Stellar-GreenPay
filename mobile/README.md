# Stellar GreenPay Mobile App

React Native + Expo mobile app for Stellar GreenPay climate donation platform.

## Features

- Browse climate projects
- Donate using mobile Stellar wallet (Freighter deep links)
- View donation history and impact
- Real-time donation feed
- Push notifications for donation receipts

## Setup

1. Install dependencies:
```bash
cd mobile
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your API URL and Stellar network settings
```

3. Run on device/simulator:
```bash
# iOS
npm run ios

# Android
npm run android

# Expo Go (for quick testing)
npm start
```

## Expo Go Preview

Preview builds are generated automatically on every push to `main` via EAS Build.

[![Open in Expo Go](https://img.shields.io/badge/Expo%20Go-Scan%20QR-000?logo=expo)](https://expo.dev/@OWNER/stellar-greenpay)

> Replace `OWNER` with your Expo account username. Add `EXPO_TOKEN` as a GitHub Actions repository secret (Settings → Secrets and variables → Actions) before the first build.

- **Android**: APK (direct install, no Play Store needed)
- **iOS**: Simulator build (`.app` bundle, not a signed IPA)

## Shared API Client

The mobile app shares the API client logic with the web frontend. The API functions are located in `lib/api.ts` and are imported from the shared package.

## Wallet Integration

The app integrates with mobile Stellar wallets via deep links:
- Freighter Mobile: `freighter://tx?xdr=...`
- Other wallets can be added via similar deep link schemes

## Architecture

- **expo-router**: File-based routing
- **app/**: Screen components
- **lib/**: Shared utilities (API, Stellar SDK helpers)
- **components/**: Reusable UI components
- **styles/**: Theme and styling (matches web green theme)

## Environment Variables

See `.env.example` for required variables:
- `EXPO_PUBLIC_API_URL`: Backend API URL
- `EXPO_PUBLIC_STELLAR_NETWORK`: testnet or mainnet
- `EXPO_PUBLIC_HORIZON_URL`: Stellar Horizon URL

`utils/stellarValidation.ts` also reads a plain `STELLAR_NETWORK` (the name
used by the backend) when `EXPO_PUBLIC_STELLAR_NETWORK` is absent, so a
single `.env` can drive both apps. When the resolved network is `mainnet`
the app raises a **soft** warning — the user must confirm — for any address
it knows is testnet-only, e.g. one funded through Friendbot. Valid
addresses are never hard-blocked.


## Release Process

### Prerequisites
- An Expo account with access to the EAS project the app is published under. `mobile/app.json` defines
  `name: "Stellar GreenPay"`, `slug: "stellar-greenpay"` and no `owner`, so the account that owns the
  slug is the one that can build and distribute.
- `.nvmrc` Node version locally; `mobile/eas.json` requires EAS CLI `>= 10.0.0` (`npx eas-cli@latest`).
- The repository secret `EXPO_TOKEN`, used by the preview workflow — see
  [`docs/github-actions-secrets.md`](../docs/github-actions-secrets.md) for how it is issued.
- Store submission is **not** configured (`eas.json` has no `submit` section) — see below.

### Profiles

`mobile/eas.json` defines exactly one build profile. There is no `channel` key anywhere, so no
profile is wired to an EAS Update channel.

| Profile | Platforms | Produces | Command |
|---------|-----------|----------|---------|
| `preview` | Android, iOS | APK (Android), simulator build (iOS) | `eas build --profile preview --platform all` |

There is no `production` or `store` profile and no `submit` section, so the automated path ends at the
`preview` build.

### How a build is produced
1. A push to `main` runs the **Mobile Preview Build** workflow
   ([`.github/workflows/mobile.yml`](../.github/workflows/mobile.yml)): `npm ci` in `mobile/`, the
   `expo/expo-github-action@v8` step with `token: ${{ secrets.EXPO_TOKEN }}`, then
   `eas build --platform all --profile preview --non-interactive`.
2. Locally the same build is `cd mobile && npm ci && npx eas-cli@latest build --profile preview --platform all`
   (add `--local` to build on your machine instead of EAS).
3. The build page printed by EAS is where testers install it from (APK for Android; iOS is a simulator
   build, so it does not install on a physical device).

### Versioning
- App version: `expo.version` in `mobile/app.json` (currently `1.0.0`).
- iOS build number: `expo.ios.buildNumber` (`1`); Android: `expo.android.versionCode` (`1`).
- Contract addresses are injected at build time by `mobile/app.config.js`, not by hand: it reads
  `contracts/addresses.json` for the network in `EXPO_PUBLIC_STELLAR_NETWORK` (default `testnet`) and
  writes `extra.contractId` / `extra.escrowContractId`. `EXPO_PUBLIC_CONTRACT_ID` and
  `EXPO_PUBLIC_ESCROW_CONTRACT_ID` override those values when set.
- Bump `expo.version` (and the platform build numbers) in the same PR that ships a release, since
  nothing increments them automatically.

### Environment variables
`mobile/.env.example` lists the client-side variables and their local defaults:
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_STELLAR_NETWORK`, `EXPO_PUBLIC_HORIZON_URL`,
`EXPO_PUBLIC_SOROBAN_RPC_URL`, `EXPO_PUBLIC_CONTRACT_ID`, `EXPO_PUBLIC_ESCROW_CONTRACT_ID`,
`EXPO_PUBLIC_USDC_ISSUER`, `EXPO_PUBLIC_PROJECT_ID`. The contract-id pair is normally left empty
because `app.config.js` fills it from `contracts/addresses.json`; set it only to override.
For a CI build these are not read from a `.env` file — pass what differs as `EXPO_PUBLIC_*` shell
variables to the `eas build` invocation.

### Store submission
`mobile/eas.json` has no `submit` section, so nothing ships to Google Play or the App Store
automatically. To release today: build with the `preview` profile (or add a profile for a signed
release build), then upload the artefact manually in the Play Console / App Store Connect. To
automate it, add a `submit` block to `eas.json` and extend the workflow with an `eas submit` step.

### Environment variables per environment
- Values in `mobile/.env.example` are copied to `.env` per environment (development, staging, production).
- For preview builds, the GitHub Action uses the `EXPO_TOKEN` secret; the `.env` values are not applied because EAS builds use the `expo` configuration and the `extra` block from `app.config.js` (which reads contract addresses from `contracts/addresses.json`).
- To override variables for a build, create a `.env` file locally and run `eas build --profile preview --local` or set `EXPO_PUBLIC_*` variables in the shell.

### Store submission
- No `submit` section exists in `mobile/eas.json`; therefore automated store submission is not configured.
- To submit to Google Play or Apple App Store, generate the build via `eas build --profile preview` (or a custom profile) and upload the resulting binary manually through the respective developer consoles, or define a `submit` profile in `eas.json` following Expo documentation.
