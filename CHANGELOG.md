# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CHANGELOG.md — project changelog tracking.
- Per-donation CO₂ offset in donation API responses via `co2OffsetKg` field, computed as `amount_xlm × co2_per_xlm / 1000` across all donation endpoints (#365).
- On-chain USDC to XLM price conversion through a configured oracle adapter (#345).
- Untracked test coverage reports, added full coverage ignore rules in `.gitignore`, and configured CI to upload coverage reports as GitHub Actions workflow artifacts (#1046).
- Dead-letter handling for stats refresh background queue (`statsRefreshQueue.js`), including Sentry failure logging, `dead_letter` database table persistence, pg-boss archiving, and Prometheus `stats_refresh_failures_total` failure metric tracking (#1089).

### Fixed

- Removed duplicate `defaults` key in backend CI workflow (`backend.yml`) and updated `moduleResolution` to `bundler` with `ES2020` in backend `tsconfig.json`.
- Fixed invalid donation UUID format in `projects.campaigns.integration.test.js` and mocked Stellar Horizon `getTransaction` in `donations.integration.test.js`.


## [1.0.0] - 2025-01-01

### Added

- Wallet Connect via Freighter browser extension.
- Browse verified climate projects with impact metrics.
- Direct on-chain XLM donations to project wallets.
- Soroban smart contract for donation and CO₂ offset tracking.
- Donor leaderboard ranked by total XLM given.
- Project updates — organisations post progress updates to donors.
- CI/CD pipelines (lint, type-check, test, build, e2e, DAST).
- Docker Compose development environment with hot reload.
- Gitleaks secret scanning in CI.
- Backend API with Express and PostgreSQL.
- Mobile app (React Native / Expo).
- Browser extension.
- Helm chart for Kubernetes deployment.
