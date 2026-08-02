# Troubleshooting

## Digest email delivery failures

Use this checklist when monthly impact digest emails are not delivered or the
`monthly-impact-digest` queue appears stuck.

### Check pg-boss job status

The digest worker is registered by `backend/src/services/digestQueue.js` with
the queue name `monthly-impact-digest`. Confirm the backend is running, then
inspect the pg-boss job table in the application database:

```sql
SELECT id, name, state, "createdOn", "startedOn", "completedOn", output
FROM pgboss.job
WHERE name = 'monthly-impact-digest'
ORDER BY "createdOn" DESC
LIMIT 20;
```

Healthy jobs should move from `created` or `active` to `completed`. If jobs are
stuck or failing, check the backend logs for digest events such as
`digest_pgboss_error`, `digest_project_error`, `digest_resend_error`, and
`digest_fetch_error`.

### Verify RESEND_API_KEY is set and valid

Digest delivery is skipped when `RESEND_API_KEY` is missing. Check the backend
environment before starting the server:

```bash
echo "$RESEND_API_KEY"
```

If it is empty, add a valid Resend API key to the backend environment, secret,
or deployment configuration, then restart the backend. In Kubernetes, confirm
the secret value is populated and mounted into the backend pod.

If `RESEND_API_KEY` is set but mail still fails, create or rotate the key in
Resend and update the deployed secret. Backend logs with `digest_resend_error`
usually include the Resend response body, which can identify invalid keys,
permission problems, or sender-domain issues.

### Fix an unverified EMAIL_FROM domain

Resend requires the sender domain in `EMAIL_FROM` to be verified before it can
send production mail. If Resend rejects digest emails because the sender domain
is not verified:

1. Open the Resend dashboard and add the domain used by `EMAIL_FROM`.
2. Add the DNS records Resend provides for SPF, DKIM, and any required
   verification records.
3. Wait for Resend to mark the domain as verified.
4. Update `EMAIL_FROM` to use an address on that verified domain, such as
   `GreenPay <updates@yourdomain.com>`.
5. Restart the backend so the new environment value is loaded.

For temporary testing, use a Resend-approved test sender or a sender address on
an already verified domain.

### Manually trigger a digest run

Run the digest manually from the backend directory:

```bash
cd backend
node -e 'require("./src/services/digestQueue").runDigest()'
```

The command uses the same `DATABASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and
`APP_URL` values as the backend process. Watch the output or backend logs for
`digest_run_start`, `digest_project_sent`, `digest_resend_error`, and
`digest_run_complete` to confirm whether the run sent mail or failed.
