# Database Documentation

## Overview

GreenPay uses PostgreSQL 16 as its primary database for managing user accounts, transactions, and smart contract interactions.

## Database Setup

### Docker Compose (Development)

The database is configured in `docker-compose.yml`:

```yaml
postgres:
  image: postgres:16-alpine
  ports:
    - "5432:5432"
  environment:
    - POSTGRES_USER=postgres
    - POSTGRES_PASSWORD=postgres
    - POSTGRES_DB=greenpay
  volumes:
    - postgres_data:/var/lib/postgresql/data
```

**Default credentials** (development only):
- Username: `postgres`
- Password: `postgres`
- Database: `greenpay`
- Port: `5432`

### Production Database

For production deployments:
- Use strong, randomly generated passwords
- Enable SSL/TLS connections
- Configure proper firewall rules
- Use managed database services (RDS, Cloud SQL) when possible
- Enable automated backups

## Database Backup Strategy

### Automated Backups

GreenPay implements automated nightly database backups to cloud storage for disaster recovery.

#### Backup Flow

```
PostgreSQL Database → pg_dump → gzip compression → Cloud Storage (S3/GCS)
```

#### Configuration

Backups are configured via GitHub Actions workflow: `.github/workflows/database-backup.yml`

**Schedule:** Daily at 2 AM UTC (configurable)

**Storage Options:**
- **AWS S3:** Default option for AWS deployments
- **Google Cloud Storage:** Option for GCP deployments

#### Required Environment Variables

For GitHub Actions secrets, configure the following:

**Common:**
- `DB_HOST`: Database hostname/IP
- `DB_PORT`: Database port (default: 5432)
- `DB_USER`: Database user
- `DB_PASSWORD`: Database password
- `DB_NAME`: Database name (default: greenpay)
- `BACKUP_RETENTION_DAYS`: Days to retain backups (default: 30)

**For S3 Backups:**
- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
- `AWS_REGION`: AWS region (default: us-east-1)
- `S3_BUCKET`: S3 bucket name
- `S3_PREFIX`: S3 prefix for backups (default: `backups/`)

**For GCS Backups:**
- `GCS_SA_KEY`: Google Cloud Service Account JSON key (base64 encoded)
- `GCP_PROJECT_ID`: GCP project ID
- `GCS_BUCKET`: GCS bucket name
- `GCS_PREFIX`: GCS prefix for backups (default: `backups/`)

### Backup File Format

- **Naming:** `greenpay_backup_YYYYMMDD_HHMMSS.sql.gz`
- **Format:** SQL dump compressed with gzip
- **Size:** ~10-100 MB typical (depends on data volume)
- **Metadata:** Backup timestamp and database name stored in cloud storage metadata

### Manual Backups

To manually create a backup:

```bash
# Using the backup script
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=greenpay
export STORAGE_TYPE=s3  # or 'gcs'
export S3_BUCKET=my-backup-bucket
export BACKUP_DIR=/tmp/backups

bash scripts/backup-db.sh
```

**Local backup only (without cloud upload):**
```bash
pg_dump -h localhost -p 5432 -U postgres greenpay | gzip > greenpay_backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

## Database Restore Procedures

### Prerequisites

Before restoring, ensure:
1. PostgreSQL client tools are installed
2. Target PostgreSQL server is running and accessible
3. You have credentials with database creation privileges
4. Backup file is available (local or downloaded from cloud storage)

### Restore from S3 Backup

```bash
# 1. List available backups in S3
aws s3 ls s3://my-backup-bucket/backups/

# 2. Download the backup file
aws s3 cp s3://my-backup-bucket/backups/greenpay_backup_20240101_020000.sql.gz .

# 3. Decompress
gunzip greenpay_backup_20240101_020000.sql.gz

# 4. Restore to database (see "Restore to PostgreSQL" section below)
```

### Restore from GCS Backup

```bash
# 1. List available backups in GCS
gsutil ls gs://my-backup-bucket/backups/

# 2. Download the backup file
gsutil cp gs://my-backup-bucket/backups/greenpay_backup_20240101_020000.sql.gz .

# 3. Decompress
gunzip greenpay_backup_20240101_020000.sql.gz

# 4. Restore to database (see "Restore to PostgreSQL" section below)
```

### Restore to PostgreSQL

#### Option 1: Restore to Existing Database (Replace)

```bash
# Decompress if needed
gunzip greenpay_backup_*.sql.gz

# Drop existing database (WARNING: Data will be lost)
dropdb -h localhost -U postgres greenpay

# Create fresh database
createdb -h localhost -U postgres greenpay

# Restore from backup
psql -h localhost -U postgres greenpay < greenpay_backup_*.sql
```

#### Option 2: Restore to New Database (Parallel)

```bash
# Decompress if needed
gunzip greenpay_backup_*.sql.gz

# Create new database with different name
createdb -h localhost -U postgres greenpay_restored

# Restore from backup
psql -h localhost -U postgres greenpay_restored < greenpay_backup_*.sql

# Verify data integrity
psql -h localhost -U postgres greenpay_restored -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
```

#### Option 3: Restore with Docker Compose

```bash
# 1. Copy backup file to container
docker cp greenpay_backup_*.sql greenpay-postgres-1:/tmp/

# 2. Decompress inside container
docker exec greenpay-postgres-1 gunzip /tmp/greenpay_backup_*.sql.gz

# 3. Drop and recreate database
docker exec -e PGPASSWORD=postgres greenpay-postgres-1 dropdb -U postgres greenpay
docker exec -e PGPASSWORD=postgres greenpay-postgres-1 createdb -U postgres greenpay

# 4. Restore
docker exec -e PGPASSWORD=postgres greenpay-postgres-1 psql -U postgres greenpay < greenpay_backup_*.sql
```

### Restore with Docker Compose (Alternative)

```bash
# Using docker-compose with mounted volume
docker-compose exec -T postgres sh -c 'gunzip /tmp/backup.sql.gz && psql -U postgres greenpay < /tmp/backup.sql'
```

### Verify Restore Success

After restoring, verify the backup:

```bash
# Connect to restored database
psql -h localhost -U postgres greenpay

# Check table counts
SELECT schemaname, COUNT(*) as table_count 
FROM pg_tables 
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
GROUP BY schemaname;

# Check for data
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM transactions;

# Exit
\q
```

## Point-in-Time Recovery (PITR)

For point-in-time recovery:

1. Enable WAL (Write-Ahead Logging) archiving
2. Archive WAL files to S3/GCS
3. Use `pg_restore` with recovery target time

Example configuration in postgresql.conf:

```postgresql
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://my-backup-bucket/wal/%f'
archive_timeout = 300
```

## Backup Testing

### Automated Testing

The backup workflow includes failure notifications. Failed backups will create an issue in the repository.

### Manual Restore Test

To verify backup integrity:

```bash
# 1. Create a temporary PostgreSQL instance
docker run -d \
  --name postgres-test \
  -e POSTGRES_PASSWORD=testpass \
  -p 5433:5432 \
  postgres:16-alpine

# 2. Download and restore backup
aws s3 cp s3://my-backup-bucket/backups/greenpay_backup_latest.sql.gz .
gunzip greenpay_backup_latest.sql.gz

# 3. Wait for container to be ready
sleep 10

# 4. Create database and restore
PGPASSWORD=testpass psql -h localhost -p 5433 -U postgres -c "CREATE DATABASE greenpay;"
PGPASSWORD=testpass psql -h localhost -p 5433 -U postgres greenpay < greenpay_backup_latest.sql

# 5. Verify data
PGPASSWORD=testpass psql -h localhost -p 5433 -U postgres greenpay -c "SELECT COUNT(*) FROM information_schema.tables;"

# 6. Cleanup
docker stop postgres-test
docker rm postgres-test
```

## Troubleshooting

### Backup Fails with "could not connect to server"

**Solution:**
- Verify database credentials in GitHub Actions secrets
- Check database hostname/IP accessibility from GitHub Actions runners
- Ensure database user has backup permissions
- For private databases, consider using GitHub Actions self-hosted runners

### Restore Fails with "permission denied"

**Solution:**
```bash
# Restore with appropriate role/owner
pg_restore -h localhost -U postgres --role=postgres greenpay_backup.sql
```

### Backup File Corrupted

**Solution:**
1. Verify file integrity: `file greenpay_backup_*.sql.gz`
2. Try to decompress: `gunzip -t greenpay_backup_*.sql.gz`
3. Try alternate backup from S3/GCS
4. If all backups corrupted, contact DevOps team

### Out of Disk Space During Restore

**Solution:**
```bash
# Use streaming restore instead
psql -h localhost -U postgres greenpay < backup.sql | head -n 1000

# Or restore in chunks if backup is very large
```

## Performance Tuning

### Backup Performance

For faster backups, use parallel dump:

```bash
pg_dump -h localhost -U postgres greenpay \
  --jobs=4 \
  --format=directory \
  --verbose > greenpay_backup_parallel
```

### Restore Performance

For faster restores:

```bash
# Disable indexes during restore
psql -h localhost -U postgres greenpay \
  -v ON_ERROR_STOP=1 \
  --single-transaction < backup.sql
```

## Security Considerations

1. **Encryption in Transit:** Use SSL/TLS for database connections
2. **Encryption at Rest:** Enable S3/GCS encryption
3. **Access Control:** Use IAM roles and service accounts with least privilege
4. **Audit Logging:** Enable CloudTrail (AWS) or Cloud Audit Logs (GCP)
5. **Retention Policy:** Set appropriate backup retention based on compliance requirements
6. **Sensitive Data:** Consider PII redaction in backups for non-production environments

## Related Files

- Backup Script: [scripts/backup-db.sh](../scripts/backup-db.sh)
- GitHub Actions Workflow: [.github/workflows/database-backup.yml](../.github/workflows/database-backup.yml)
- Docker Compose: [docker-compose.yml](../docker-compose.yml)

## Contact & Support

For database issues or backup concerns:
- Create an issue: [GitHub Issues](https://github.com/Emmy123222/Stellar-GreenPay/issues)
- Check existing documentation: [README.md](../README.md)
