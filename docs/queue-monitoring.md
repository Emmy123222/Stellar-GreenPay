# Queue monitoring and alerting guide

This guide covers operational monitoring for pg-boss-backed background jobs in Stellar GreenPay.

## What to monitor

The main queues to watch are:

- `digest` for scheduled impact digest jobs
- `profileUpdate` for profile refresh work
- `summaryQueue` for AI summary generation jobs

These queues should be monitored for:

- queue depth growth over time
- repeated failed jobs
- stalled jobs that remain in a non-terminal state

## Query pg-boss queue state

pg-boss stores job state in the `pgboss.job` table. The following query is useful for identifying failed jobs:

```sql
SELECT *
FROM pgboss.job
WHERE state = 'failed';
```

A broader health check can be used to inspect queue depth and state distribution:

```sql
SELECT
  name,
  state,
  COUNT(*) AS job_count
FROM pgboss.job
GROUP BY name, state
ORDER BY name, state;
```

### Useful filters

Inspect jobs for a specific queue:

```sql
SELECT *
FROM pgboss.job
WHERE name = 'summaryQueue'
ORDER BY createdon DESC;
```

Inspect only retries that are still pending:

```sql
SELECT *
FROM pgboss.job
WHERE name = 'profileUpdate'
  AND state IN ('created', 'retry', 'active');
```

## Alerting recommendations

### Alert on these queues

Create alerts for the following queues if their backlog grows unexpectedly or if failures remain above baseline:

- `digest`
- `profileUpdate`
- `summaryQueue`

Recommended alert conditions:

- queue depth above 50 for 10 minutes
- failed jobs count above 0 for 5 minutes
- no active worker activity for a queue for 15 minutes

## Grafana dashboard example

The following Grafana dashboard JSON exports a simple panel for queue depth visualization. Import it into Grafana and adjust the PostgreSQL datasource as needed.

```json
{
  "annotations": {
    "list": [
      {
        "builtIn": 1,
        "datasource": {
          "type": "grafana",
          "uid": "-- Grafana --"
        },
        "enable": true,
        "hide": true,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts",
        "type": "dashboard"
      }
    ]
  },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "panels": [
    {
      "datasource": {
        "type": "postgres",
        "uid": "postgres"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "unit": "short"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 0
      },
      "id": 1,
      "options": {
        "legend": {
          "displayMode": "list",
          "placement": "bottom"
        },
        "tooltip": {
          "mode": "single",
          "sort": "none"
        }
      },
      "targets": [
        {
          "format": "time_series",
          "rawSql": "SELECT createdon AS time, COUNT(*) AS queue_depth FROM pgboss.job WHERE state IN ('created', 'retry', 'active') GROUP BY createdon ORDER BY createdon",
          "refId": "A"
        }
      ],
      "title": "pg-boss queue depth",
      "type": "timeseries"
    }
  ],
  "schemaVersion": 39,
  "style": "dark",
  "tags": [
    "postgres",
    "pg-boss",
    "monitoring"
  ],
  "templating": {
    "list": []
  },
  "time": {
    "from": "now-6h",
    "to": "now"
  },
  "timepicker": {},
  "timezone": "browser",
  "title": "Stellar GreenPay queue monitoring",
  "version": 1
}
```

## Manually retry failed jobs

Failed jobs can be retried manually when the underlying issue has been resolved.

### Retry a single failed job

Use the pg-boss job ID from the failed job row:

```sql
SELECT *
FROM pgboss.job
WHERE id = '<job-id>';
```

If the job is still available in the queue tables, reinsert it by using the same payload that originally created it. In practice, this is usually done by re-running the worker trigger or by replaying the event that created the job.

### Retry all failed jobs for a queue

For a queue-wide retry, inspect the failed jobs first:

```sql
SELECT id, name, state, retrycount
FROM pgboss.job
WHERE name = 'summaryQueue'
  AND state = 'failed';
```

Then replay the failed work from the application layer or requeue the jobs using the same job payloads that were originally created.

## Operational checklist

1. Check failed jobs with `SELECT * FROM pgboss.job WHERE state = 'failed';`
2. Review backlog for `digest`, `profileUpdate`, and `summaryQueue`
3. Confirm worker processes are still running
4. Retry failed jobs only after the root cause is addressed
5. Verify queue depth returns to normal after recovery
