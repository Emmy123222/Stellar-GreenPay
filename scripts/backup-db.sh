#!/bin/bash

# Database Backup Script
# Backs up PostgreSQL database and uploads to S3 or GCS
# Supports both AWS S3 and Google Cloud Storage

set -euo pipefail

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-greenpay}"
DB_PASSWORD="${DB_PASSWORD:-}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/backups}"
STORAGE_TYPE="${STORAGE_TYPE:-s3}"  # 's3' or 'gcs'
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-backups/}"
GCS_BUCKET="${GCS_BUCKET:-}"
GCS_PREFIX="${GCS_PREFIX:-backups/}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Timestamp for backup file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="greenpay_backup_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# Logging
log_info() {
    echo "[INFO] $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
    echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') $1" >&2
}

# Create backup directory
mkdir -p "${BACKUP_DIR}"

log_info "Starting database backup..."
log_info "Database: $DB_NAME on $DB_HOST:$DB_PORT"
log_info "Backup file: $BACKUP_FILE"

# Export password if provided
if [ -n "$DB_PASSWORD" ]; then
    export PGPASSWORD="$DB_PASSWORD"
fi

# Create the backup
if ! pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --no-password \
    | gzip > "$BACKUP_PATH"; then
    log_error "Database backup failed"
    exit 1
fi

log_info "Database backup completed successfully"
log_info "Backup file size: $(du -h "$BACKUP_PATH" | cut -f1)"

# Upload to cloud storage
case "$STORAGE_TYPE" in
    s3)
        upload_to_s3
        ;;
    gcs)
        upload_to_gcs
        ;;
    *)
        log_error "Unknown storage type: $STORAGE_TYPE"
        exit 1
        ;;
esac

# Cleanup old backups locally
log_info "Cleaning up local backups older than $RETENTION_DAYS days..."
find "${BACKUP_DIR}" -name "greenpay_backup_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
log_info "Local backup cleanup completed"

log_info "Database backup and upload completed successfully"

upload_to_s3() {
    if [ -z "$S3_BUCKET" ]; then
        log_error "S3_BUCKET environment variable is not set"
        return 1
    fi

    log_info "Uploading backup to S3..."
    
    # Validate AWS CLI is installed
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is not installed"
        return 1
    fi

    # Upload to S3
    REMOTE_PATH="s3://${S3_BUCKET}/${S3_PREFIX}${BACKUP_FILE}"
    if aws s3 cp "$BACKUP_PATH" "$REMOTE_PATH" \
        --sse AES256 \
        --storage-class STANDARD_IA \
        --metadata "backup-date=${TIMESTAMP},database=${DB_NAME}"; then
        log_info "Successfully uploaded to $REMOTE_PATH"
        return 0
    else
        log_error "Failed to upload backup to S3"
        return 1
    fi
}

upload_to_gcs() {
    if [ -z "$GCS_BUCKET" ]; then
        log_error "GCS_BUCKET environment variable is not set"
        return 1
    fi

    log_info "Uploading backup to GCS..."

    # Validate gsutil is installed
    if ! command -v gsutil &> /dev/null; then
        log_error "gsutil (Google Cloud SDK) is not installed"
        return 1
    fi

    # Upload to GCS
    REMOTE_PATH="gs://${GCS_BUCKET}/${GCS_PREFIX}${BACKUP_FILE}"
    if gsutil -h "Content-Type:application/gzip" \
        -h "x-goog-meta-backup-date:${TIMESTAMP}" \
        -h "x-goog-meta-database:${DB_NAME}" \
        cp "$BACKUP_PATH" "$REMOTE_PATH"; then
        log_info "Successfully uploaded to $REMOTE_PATH"
        
        # Set lifecycle policy to delete old backups after RETENTION_DAYS
        # This is handled at the bucket level, not per object
        return 0
    else
        log_error "Failed to upload backup to GCS"
        return 1
    fi
}
