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

### Fixed

- Project cover photos that fail to load now fall back to a branded leaf placeholder (`/project-placeholder.svg`) instead of a broken-image icon, in both `ProjectCard` and the map popup (#1069).
- The live donation feed detects a dropped Horizon SSE stream, shows a "Reconnecting…" banner, retries with exponential backoff, and merges anything that arrived while disconnected via a REST catch-up (#1071).
- The selected language persists across sessions under `greenpay:locale` (migrated from the bare `locale` key), falls back to `navigator.language`, and sets `<html lang>` before first paint instead of re-rendering after hydration (#1073).


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
