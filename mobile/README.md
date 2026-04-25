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
