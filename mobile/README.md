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

The GitHub Actions workflow builds the `preview` profile on every push to
`main`. A successful build is uploaded to EAS; the workflow does not submit it
to an app store or configure an OTA update.

[![Open in Expo Go](https://img.shields.io/badge/Expo%20Go-Scan%20QR-000?logo=expo)](https://expo.dev/@OWNER/stellar-greenpay)

> Replace `OWNER` with your Expo account username. Add `EXPO_TOKEN` as a GitHub Actions repository secret (Settings → Secrets and variables → Actions) before the first build.

- **Android**: APK (direct install, no Play Store needed)
- **iOS**: Simulator build (`.app` bundle, not a signed IPA)

## Mobile Build and Release

### Prerequisites and access

- An Expo account with access to the `stellar-greenpay` EAS project. Ask the
  project owner to invite you with access to create builds. A project admin
  must link the app to that EAS project with `eas init` and commit the
  resulting `extra.eas.projectId` configuration before CI can build it.
- EAS CLI (`npm install --global eas-cli`) and a working Expo login for local
  builds. CI authenticates with the GitHub repository secret `EXPO_TOKEN`.
- For store releases, a release maintainer must also have the required Apple
  App Store Connect and/or Google Play Console access and valid signing and
  submission credentials. Store submission is not enabled in the current
  GitHub Actions workflow.

### Profiles, channels, and distribution

`mobile/eas.json` currently defines only the `preview` profile. It does not
assign an EAS Update channel, and there is no production/store profile yet.

| EAS profile | Platforms and artifact | EAS Update channel | How it runs / distribution |
|-------------|------------------------|--------------------|----------------------------|
| `preview` | Android APK; iOS simulator app | None configured | `.github/workflows/mobile.yml` starts this build on pushes to `main`. The APK can be shared for Android device testing; the iOS simulator artifact requires a simulator and is not installable on a physical iPhone. |
| Production/store | Not configured | None configured | A store-ready profile, signing setup, and store credentials must be configured before building or submitting a production release. |

Merging a mobile PR does not itself create a build; once its changes reach
`main`, the workflow runs `eas build --platform all --profile preview
--non-interactive`. Check the workflow run for success, then use the EAS
project's Builds page to retrieve the Android APK or simulator artifact and
share it with the appropriate testers. A failed build must be resolved and
rerun before distributing anything.

To build locally from `mobile/`, authenticate with the Expo account and run:

```bash
eas build --platform all --profile preview
```

To build only one platform, replace `all` with `android` or `ios`. These
commands create the configured preview artifacts, not app-store binaries.

### Versioning and build environment

The app version is `expo.version` in `mobile/app.json` (currently `1.0.0`).
Before each store release, increment it as required by the release, and
increment the platform build numbers there as well: `ios.buildNumber` and
`android.versionCode`. This project has not enabled EAS remote version
management, so keep those values in source control and ensure store build
numbers are unique and increasing. `mobile/app.config.js` does not calculate
or increment versions; it keeps the base Expo config and injects network
specific contract addresses.

Use `mobile/.env.example` as the variable-name template, not as production
configuration. Create a local `mobile/.env` for local development; the GitHub
workflow does not copy that file into EAS. Configure the appropriate public
values for each build environment in the EAS project's build environment, and
verify them before building:

| Variable(s) | Source / handling |
|-------------|-------------------|
| `EXPO_PUBLIC_API_URL` | The API base URL for the backend environment the testers or release will use. Do not ship the local-development URL to external testers. |
| `EXPO_PUBLIC_STELLAR_NETWORK`, `EXPO_PUBLIC_HORIZON_URL`, `EXPO_PUBLIC_SOROBAN_RPC_URL` | Select the target Stellar network and use its Horizon and Soroban RPC endpoints from the Stellar network/service operator. Keep these consistent for the target environment. |
| `EXPO_PUBLIC_CONTRACT_ID`, `EXPO_PUBLIC_ESCROW_CONTRACT_ID` | Prefer the network-specific `greenpay` and `escrow` entries in `contracts/addresses.json`; `mobile/app.config.js` uses them and allows these variables to override them. |
| `EXPO_PUBLIC_USDC_ISSUER` | The issuer address for the USDC asset on the selected Stellar network, supplied by the asset/network operator if that integration is enabled. |
| `EXPO_PUBLIC_PROJECT_ID` | The Expo project ID from the EAS project settings, used by `utils/notifications.ts` to request push-notification tokens. Keep it in sync with the linked EAS project; it is public configuration, not a credential. |

All `EXPO_PUBLIC_*` values are public and are bundled into the client; never
put credentials or other private values in them. Contract addresses are
maintained in `contracts/addresses.json`; confirm that file contains the
correct network entries before building.

### Store submission

Store submission is a separate, deliberate release-maintainer action. The
current `preview` profile cannot be submitted: its Android output is an APK
and its iOS output is a simulator build. First configure a store-ready EAS
build profile and platform signing/submission credentials, then create and
verify the store-ready build. Only a maintainer authorized for the Expo
project and the relevant app-store account should submit it.

After that setup, EAS CLI can submit a selected store-ready build, for example:

```bash
eas submit --platform android --latest
eas submit --platform ios --latest
```

Run only the command for the platform being released, and only when the
selected latest build is the verified store-ready artifact. These commands do
not make the current preview artifacts suitable for store submission. The
repository has no automated store-submit step; review the EAS submission
result and complete any required store-console review or release action.

### OTA update policy

`expo-updates` is not currently a mobile dependency, and no runtime version or
EAS Update channel is configured. Therefore there is no OTA update release
path: changes reach testers through a new build. If OTA updates are adopted,
configure `expo-updates`, runtime-version compatibility, and channels for the
intended environments before using `eas update --channel <channel>`. Only
publish JavaScript/assets compatible with the installed native runtime; native
code or configuration changes require a new binary build.

## Shared API Client

The mobile app shares the API client logic with the web frontend. The API functions are located in `lib/api.ts` and are imported from the shared package.

## Wallet Integration

The app integrates with mobile Stellar wallets via deep links:
- Freighter Mobile: `freighter://tx?xdr=...`
- Other wallets can be added via similar deep link schemes

## Deep Links

The app registers the custom scheme `greenpay://` (plus universal links for
`https://<domain>/project/*`) in `app.json`, mounts `hooks/useDeepLink.ts` from
the root layout (`app/_layout.tsx`), and ships association files in
`mobile/.well-known/` that must be published by the web frontend.

Flow: OS resolves the URL → `useDeepLink()` parses it with `expo-linking` →
`router.push()` → expo-router screen in `app/`.

### Supported link patterns

| Link | Opens screen | Handled by |
| --- | --- | --- |
| `greenpay://project/<projectId>` | `/projects/<projectId>` (Project Details) | `useDeepLink` |
| `greenpay://donate/<G…address>` | `/donate/<address>` (Donate, destination pre-selected) | `useDeepLink` |
| `greenpay://profile/<G…address>` | `/profile/<address>` (Donor Profile) | expo-router file route (`app/profile/[address].tsx`) |
| `https://<domain>/project/<projectId>` | `/projects/<projectId>` | `useDeepLink` (universal link; requires `.well-known` files, see below) |
| `greenpay://donate?wallet=<G…>&project=<id>` | `/donate/<id>?wallet=<G…>` | In-app QR parsing only (`app/scan.tsx`) — the hook ignores query-only `donate` paths |
| any other `greenpay://<segment>/<param>` | nothing | ignored (covered by `__tests__/useDeepLink.test.ts`) |

The hook handles both **cold starts** (`Linking.getInitialURL()`) and **warm
starts** (`Linking.addEventListener('url', …)`), so links received while the app
is open navigate too. Run `npm test` in `mobile/` to exercise these cases.

### Hosting the `.well-known` association files

Universal links (iOS `applinks:` / Android App Links) only work if the files are
served **from the frontend's public root**, i.e. `frontend/public/.well-known/`,
which Next.js publishes verbatim:

| File | Must be reachable at | Repo source |
| --- | --- | --- |
| `apple-app-site-association` | `https://<domain>/.well-known/apple-app-site-association` | `mobile/.well-known/apple-app-site-association` (copy kept in sync with `frontend/public/.well-known/`) |
| `assetlinks.json` | `https://<domain>/.well-known/assetlinks.json` | `frontend/public/.well-known/assetlinks.json` |

Requirements:

- Served over **HTTPS**, on the exact host configured in `app.json`
  (`ios.associatedDomains: ["applinks:<domain>"]`,
  `android.intentFilters` → `https` + `pathPrefix: "/project/"`).
- The AASA file has **no extension** — it must not be rewritten or blocked by
  the server; `Content-Type: application/json` is recommended.
- Replace the placeholders before shipping: `TEAMID` in
  `apple-app-site-association` (Apple Developer Team ID), and the
  `sha256_cert_fingerprints` array in `assetlinks.json` (signing cert
  fingerprint of the `com.stellargreenpay.app` upload key). Both files must
  match `bundleIdentifier` / `package` in `app.json`.
- `mobile/.well-known/` is not served by anything itself — it is the in-repo
  copy for the mobile side. After editing it, copy it to
  `frontend/public/.well-known/` so both stay identical.

Quick check that the files are served from the public root:

```bash
npx serve frontend/public          # or run the Next.js dev server
curl -sI http://localhost:3000/.well-known/apple-app-site-association
curl -sI http://localhost:3000/.well-known/assetlinks.json
```

Both must return `200` (then repeat against the deployed domain).

### Testing deep links

Two environments, two different capabilities:

| | Expo Go (`npm start`) | Dev build (`npx expo run:ios` / `run:android` or EAS `preview`) |
| --- | --- | --- |
| `greenpay://` custom scheme | ✗ Expo Go owns the `exp://` scheme, so the OS cannot deliver `greenpay://` URLs to it | ✓ registered for the app's own bundle id/package |
| `https://<domain>/…` universal links | ✗ App Links/AASA verify against Expo Go's bundle id, never the app's | ✓ verified once the `.well-known` files are live |
| Screen routing sanity check | ✓ open `exp://<host>:8081/--/projects/42`, or run the unit tests | ✓ |

Build a test binary with the EAS `preview` profile defined in `eas.json`
(Android APK, iOS simulator build):

```bash
cd mobile
eas build --profile preview --platform android   # or --platform ios
```

**Android (dev build or emulator)**

```bash
# custom scheme
npx uri-scheme open "greenpay://project/42" --android
adb shell am start -W -a android.intent.action.VIEW -d "greenpay://donate/GABCXYZ"

# universal link (requires hosted .well-known + verified domain)
adb shell am start -W -a android.intent.action.VIEW -d "https://<domain>/project/42"

# confirm the link resolves to the app (API 31+)
adb shell pm verify-app-links --re-verify com.stellargreenpay.app
adb shell cmd package query-activities --brief -a android.intent.action.VIEW -d "https://<domain>/project/42"
```

**iOS (simulator, dev build)**

```bash
# custom scheme
npx uri-scheme open "greenpay://project/42" --ios
xcrun simctl openurl booted "greenpay://donate/GABCXYZ"

# universal link — opens Safari/Notes first if AASA is not yet fetched;
# once fetched, tapping the same https link opens the app directly
xcrun simctl openurl booted "https://<domain>/project/42"
```

Verify the association file is fetchable the way iOS does it (no headers, no
redirects): `curl https://<domain>/.well-known/apple-app-site-association`.
If the universal link stays in the browser, re-check the host in `app.json`,
the `TEAMID`/bundle id in the AASA file, and that the file is served from
`frontend/public/.well-known/`.

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
