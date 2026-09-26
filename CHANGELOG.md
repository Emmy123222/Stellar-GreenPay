# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CHANGELOG.md — project changelog tracking.
- Per-donation CO₂ offset in donation API responses via `co2OffsetKg` field, computed as `amount_xlm × co2_per_xlm / 1000` across all donation endpoints (#365).
- On-chain USDC to XLM price conversion through a configured oracle adapter (#345).
- NSFW and violent-content scanning for project-update images via AWS Rekognition `DetectModerationLabels`, with every verdict logged to the new `update_images` table that doubles as the admin review queue (`Explicit Nudity`/`Violence` above 70% → 422, other labels above 50% → published and flagged for review) (#1101).
- Redis result caching for the donor leaderboard (60s TTL, key per page/cursor/period/sort/verified filter, invalidated when a donation is recorded) and a `GET /metrics` Prometheus endpoint exposing `greenpay_leaderboard_query_duration_seconds` (#1093).
- `total` donation count on `GET /api/donations/donor/:publicKey`, so the donor profile page can report progress through a long history (#1080).

### Changed

- Donor profile page now pages through donation history 20 rows at a time with a "Load more" control instead of truncating the full list client-side (#1080).
- New `STELLAR_TIMEOUT_MS` setting (default 15000) bounds Federation, stellar.toml, Horizon and Soroban RPC requests (#1097).
- New `IMAGE_MODERATION_*` settings for enabling moderation, its confidence thresholds and its fail-open/fail-closed mode (#1101).

### Fixed

- Horizon and Soroban RPC calls had no timeout, so a stalled Stellar node could pin an API worker indefinitely; a chain timeout is now answered with 503 Service Unavailable (#1097).

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
