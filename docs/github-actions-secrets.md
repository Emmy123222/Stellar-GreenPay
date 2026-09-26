# GitHub Actions Secrets Reference

This document catalogs every encrypted secret required by the Stellar GreenPay
CI/CD pipelines. Secrets are configured in the GitHub repository under
**Settings → Secrets and variables → Actions**.

> **Never** commit actual secret values to the repository. Use `.env` files
> locally and GitHub encrypted secrets in CI. The project runs
> [Gitleaks](https://github.com/gitleaks/gitleaks) on every push and PR to
> prevent accidental secret exposure (see `.github/workflows/secret-scanning.yml`).

---

## Table of Contents

1. [Automatic Secrets (no setup required)](#1-automatic-secrets-no-setup-required)
2. [CI Workflow Secrets](#2-ci-workflow-secrets)
3. [Database Backup Workflow Secrets](#3-database-backup-workflow-secrets)
4. [Mobile Preview Build Secrets](#4-mobile-preview-build-secrets)
5. [Quick Setup Guide](#5-quick-setup-guide)
6. [Secret Reference Table](#6-secret-reference-table)
7. [Rotating Secrets](#7-rotating-secrets)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Automatic Secrets (no setup required)

The following secret is provided automatically by GitHub Actions for every
workflow run and requires **no manual configuration**:

| Secret | Provided By | Used In |
|--------|-------------|---------|
| `secrets.GITHUB_TOKEN` | GitHub Actions runtime | `ci.yml`, `secret-scanning.yml`, `extension.yml`, `release.yml` |

`GITHUB_TOKEN` is an installation access token scoped to the repository that
triggers the workflow. Its permissions are defined by the `permissions` block
in each workflow file (see [GitHub docs](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)).

---

## 2. CI Workflow Secrets

**Workflow**: `.github/workflows/ci.yml`

The CI workflow runs frontend type-checking/linting/building, end-to-end
Playwright tests, backend linting/testing, Soroban contract checks, and a
DAST security scan with OWASP ZAP.

**Required secrets:**

| Secret | Purpose |
|--------|---------|
| `secrets.GITHUB_TOKEN` | Used by the ZAP scan action to create check runs on the PR. |

No additional secrets are needed for the CI pipeline because:
- Frontend builds use publicly known testnet values set directly in the
  workflow `env` block (`NEXT_PUBLIC_STELLAR_NETWORK=testnet`, etc.).
- Backend tests mock the database and Stellar network.
- Contract builds do not require network access.
- The ZAP baseline scan runs against the staging environment URL with the
  auto-provisioned `GITHUB_TOKEN`.

> Future enhancement: if the ZAP `fail_action` is changed from `false` to
> `true`, the token behaviour remains unchanged.

---

## 3. Database Backup Workflow Secrets

**Workflow**: `.github/workflows/database-backup.yml`

This scheduled workflow runs nightly (2 AM UTC) and can also be triggered
manually via `workflow_dispatch`. It backs up the PostgreSQL database to
either **AWS S3** or **Google Cloud Storage (GCS)**.

### S3 Storage (default)

| Secret | Required | Description |
|--------|----------|-------------|
| `AWS_ACCESS_KEY_ID` | Yes (S3) | IAM access key for the S3 bucket. |
| `AWS_SECRET_ACCESS_KEY` | Yes (S3) | IAM secret key for the S3 bucket. |
| `AWS_REGION` | No | AWS region (default: `us-east-1`). |
| `S3_BUCKET` | Yes (S3) | S3 bucket name to store backups. |
| `S3_PREFIX` | No | Prefix path within the bucket (default: `backups/`). |

### GCS Storage (alternative)

Select `gcs` as `storage_type` when manually triggering the workflow.

| Secret | Required | Description |
|--------|----------|-------------|
| `GCS_SA_KEY` | Yes (GCS) | Google Cloud service account key (JSON). |
| `GCP_PROJECT_ID` | Yes (GCS) | GCP project ID. |
| `GCS_BUCKET` | Yes (GCS) | GCS bucket name to store backups. |
| `GCS_PREFIX` | No | Prefix path within the bucket (default: `backups/`). |

### Database Connection (both storage types)

| Secret | Required | Description |
|--------|----------|-------------|
| `DB_HOST` | Yes | PostgreSQL hostname or IP address. |
| `DB_PORT` | No | PostgreSQL port (default: `5432`). |
| `DB_USER` | Yes | PostgreSQL user with read access. |
| `DB_NAME` | No | Database name (default: `greenpay`). |
| `DB_PASSWORD` | Yes | PostgreSQL user password. |
| `BACKUP_RETENTION_DAYS` | No | Number of days to keep backups (default: `30`). |

### Storage selection logic

```
if github.event.inputs.storage_type != 'gcs' AND secrets.AWS_ACCESS_KEY_ID != ''
  → Use S3 storage
else if github.event.inputs.storage_type == 'gcs'
  → Use GCS storage
```

> **Note:** The `secrets.AWS_ACCESS_KEY_ID != ''` check in the workflow's
> `if` condition means the workflow attempts S3 by default. To use GCS,
> always set `storage_type` to `gcs` when triggering manually.

---

## 4. Mobile Preview Build Secrets

**Workflow**: `.github/workflows/mobile.yml`

Triggered on every push to `main`. Builds the Expo/React Native mobile app
via EAS (Expo Application Services) for both iOS and Android preview profiles.

| Secret | Required | Description |
|--------|----------|-------------|
| `EXPO_TOKEN` | **Yes** | Expo access token for EAS builds. Generate at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens). |

### Setting up EXPO_TOKEN

1. Go to [expo.dev](https://expo.dev) and sign in.
2. Navigate to **Settings → Access Tokens**.
3. Create a new token with **Scoped** or **Full** access.
4. Copy the generated token.
5. Add it as `EXPO_TOKEN` in the repository's GitHub Secrets.

---

## 5. Quick Setup Guide

### Initial repository configuration

For a fresh clone or new repository fork, configure the following minimum set
of secrets to enable production CI/CD:

```bash
# ── Database Backup (S3) ───────────────────────────────────────
AWS_ACCESS_KEY_ID       # IAM access key
AWS_SECRET_ACCESS_KEY   # IAM secret key
AWS_REGION              # e.g. us-east-1
S3_BUCKET               # e.g. greenpay-db-backups
DB_HOST                 # PostgreSQL host
DB_USER                 # PostgreSQL user
DB_PASSWORD             # PostgreSQL password

# ── Mobile EAS Builds ──────────────────────────────────────────
EXPO_TOKEN              # Expo access token
```

### Step-by-step

1. Go to your GitHub repository → **Settings** → **Secrets and variables** →
   **Actions**.
2. Click **New repository secret**.
3. Enter the secret name (e.g. `EXPO_TOKEN`) and its value.
4. Click **Add secret**.
5. Repeat for each secret listed above.

> 🔐 Use separate IAM credentials and database users per environment
> (staging vs. production) — never share secrets across environments.

---

## 6. Secret Reference Table

| Secret | Workflow(s) | Required | Type | Default |
|--------|-------------|----------|------|---------|
| `GITHUB_TOKEN` | All | Automatic | Runtime token | — |
| `AWS_ACCESS_KEY_ID` | `database-backup.yml` | S3 only | IAM key | — |
| `AWS_SECRET_ACCESS_KEY` | `database-backup.yml` | S3 only | IAM secret | — |
| `AWS_REGION` | `database-backup.yml` | No | AWS region | `us-east-1` |
| `S3_BUCKET` | `database-backup.yml` | S3 only | Bucket name | — |
| `S3_PREFIX` | `database-backup.yml` | No | Path prefix | `backups/` |
| `GCS_SA_KEY` | `database-backup.yml` | GCS only | JSON key | — |
| `GCP_PROJECT_ID` | `database-backup.yml` | GCS only | Project ID | — |
| `GCS_BUCKET` | `database-backup.yml` | GCS only | Bucket name | — |
| `GCS_PREFIX` | `database-backup.yml` | No | Path prefix | `backups/` |
| `DB_HOST` | `database-backup.yml` | **Yes** | Hostname | — |
| `DB_PORT` | `database-backup.yml` | No | Port | `5432` |
| `DB_USER` | `database-backup.yml` | **Yes** | Username | — |
| `DB_NAME` | `database-backup.yml` | No | Database | `greenpay` |
| `DB_PASSWORD` | `database-backup.yml` | **Yes** | Password | — |
| `BACKUP_RETENTION_DAYS` | `database-backup.yml` | No | Days | `30` |
| `EXPO_TOKEN` | `mobile.yml` | **Yes** | Access token | — |

---

## 7. Rotating Secrets

When rotating any secret:

1. **Add the new value** as a repository secret **before** removing the old
   one to avoid workflow failures during the transition window.
2. Update the corresponding credential in the external service (AWS IAM,
   GCP service account, Expo, etc.).
3. **Remove the old secret** from GitHub only after confirming the new value
   works in a successful workflow run.
4. Update `.env` files locally if the secret is also used for local
   development (e.g. database credentials).

### Rotation schedule recommendation

| Secret Type | Recommended Rotation |
|-------------|---------------------|
| Database passwords | Every 90 days |
| IAM access keys | Every 90 days |
| GCP service account keys | Every 90 days |
| Expo tokens | Every 180 days |

---

## 8. Troubleshooting

### Workflow fails with "Secret not found"

```
Error: secret is required but not set
```

**Cause:** The workflow references a secret that hasn't been configured in the
repository's GitHub Secrets.

**Fix:** Add the missing secret via **Settings → Secrets and variables → Actions**.

### Database backup fails with authentication error

**Cause:** The `DB_PASSWORD` or `DB_HOST` secret is incorrect or has been
rotated.

**Fix:** Verify the database credentials and update the secret.

### S3 backup fails with access denied

**Cause:** The IAM user associated with `AWS_ACCESS_KEY_ID` lacks
`s3:PutObject` permission on the target bucket, or the bucket policy denies
the request.

**Fix:** Ensure the IAM policy includes:

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:ListBucket"],
  "Resource": [
    "arn:aws:s3:::YOUR_BUCKET",
    "arn:aws:s3:::YOUR_BUCKET/*"
  ]
}
```

### EAS build fails with "Not authenticated"

**Cause:** The `EXPO_TOKEN` is missing, expired, or invalid.

**Fix:** Generate a new token at [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens)
and update the `EXPO_TOKEN` secret.

### GCS backup fails

**Cause:** The service account key in `GCS_SA_KEY` has expired or lacks
`storage.objects.create` permission on the target bucket.

**Fix:** Verify the service account has the **Storage Object Admin** role
(`roles/storage.objectAdmin`) on the bucket, or generate a new key if
expired.

---

## Workflow Overview

| Workflow File | Trigger | Purpose |
|---------------|---------|---------|
| `.github/workflows/ci.yml` | Push to `main`/`develop`, PR to `main` | Frontend, backend, contract CI + E2E + ZAP scan |
| `.github/workflows/secret-scanning.yml` | Push, PR, manual | Gitleaks secret detection |
| `.github/workflows/database-backup.yml` | Scheduled (daily 2 AM UTC), manual | PostgreSQL backup to S3 or GCS |
| `.github/workflows/extension.yml` | Tag push `v*` | Build and release browser extension |
| `.github/workflows/mobile.yml` | Push to `main` | EAS mobile preview build |
| `.github/workflows/release.yml` | Push to `main` (with `[release]` in commit) | Semantic release automation |
