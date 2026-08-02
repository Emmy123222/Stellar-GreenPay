# Deployment Guide

This document covers the full production deployment process for Stellar-GreenPay using Kubernetes and Helm.

## Prerequisites

Before deploying to production, ensure you have the following installed and configured:

*   **`kubectl`**: The Kubernetes command-line tool.
*   **`helm`**: The Helm package manager (v3+).
*   **A Kubernetes Cluster**: Running on a cloud provider like GCP (GKE), AWS (EKS), or a managed cluster.
*   **Cloud Provider CLI**: (e.g., `gcloud` for GCP, `aws` for AWS) configured with appropriate access rights.

## Creating secrets from .env

The application requires various environment variables (e.g., database credentials, API keys) to function securely. These must be stored as Kubernetes Secrets rather than in the Helm chart directly.

Create a Kubernetes Secret from your `.env` file:

```bash
kubectl create secret generic greenpay-secrets --from-env-file=.env
```

*Note: Ensure your `.env` file is properly configured for the production environment and NEVER committed to version control.*

## Deploying with Helm

Once your secrets are in place, you can deploy the application using the provided Helm chart.

Run the following command from the root of the repository:

```bash
helm install greenpay helm/greenpay/
```

This will deploy the required deployments, services, and other resources as defined in the Helm chart.

## Configuring Ingress and TLS

To expose the application securely over HTTPS, configure an Ingress resource with TLS.

1.  **Ingress Controller**: Ensure an Ingress controller (e.g., NGINX) is running in your cluster.
2.  **Cert-Manager**: Install `cert-manager` to automatically provision and manage TLS certificates (e.g., via Let's Encrypt).
3.  **Update `values.yaml`**: Update the `helm/greenpay/values.yaml` (or pass a custom `values-prod.yaml`) to enable the Ingress and configure TLS hosts.

Example configuration snippet:
```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: api.greenpay.example.com
      paths:
        - path: /
          pathType: ImplementationSpecific
  tls:
    - secretName: greenpay-tls
      hosts:
        - api.greenpay.example.com
```

Apply the updated configuration:
```bash
helm upgrade greenpay helm/greenpay/ -f values-prod.yaml
```

## Running database migrations post-deploy

After the application is deployed, you must run the database migrations to set up the production schema.

Connect to a running backend pod or execute a one-off job to run the migration script:

```bash
kubectl exec -it deployment/greenpay-backend -- npm run migrate
```
*(Adjust the command if you use a dedicated migration job or a different package manager command.)*

### Migration Considerations and Caveats

*   **Two `002_*` Migration Files**: You will notice two migration files starting with `002_`. This happened because two contributors added them independently. They do not conflict and should both be applied.
*   **Running Migrations in the Correct Order**: The migration system will automatically execute migrations in alphabetical/numerical order based on the filename. Just run the standard migrate command, and it will apply both `002_` migrations sequentially.
*   **CONCURRENTLY Index Caveats**: If a migration creates an index `CONCURRENTLY`, be aware that this operation cannot be run inside a transaction. Ensure that your migration script or runner is configured to run such migrations outside of a transaction block to avoid failures.
*   **Rollback Procedure**: If a migration fails mid-deploy (e.g., a connection drops or a non-transactional statement fails), you may need to intervene manually.
    1.  Check the database migration history table to see which migrations successfully completed.
    2.  If a migration is in a partial state, you may need to manually clean up the applied changes.
    3.  Once the database is clean, fix the underlying issue and re-run the migration command.

## Registering the Soroban contract on mainnet

After deploying the infrastructure, you must deploy and register the Soroban smart contract on the Stellar mainnet.

1.  **Compile the Contract**: Ensure your contract is compiled to a WebAssembly (.wasm) file and optimized for deployment.
2.  **Deploy to Mainnet**: Use the Stellar CLI to deploy the contract.

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/greenpay_contract.wasm \
  --source admin \
  --network mainnet
```

Once deployed, update your application configuration (via Secrets or ConfigMaps) with the new mainnet Contract ID.

## Operations

### Leaderboard monthly snapshot

The leaderboard history is powered by the `monthly_leaderboard` table, which is populated on-demand via:

```bash
curl -X POST https://your-api.example.com/api/leaderboard/snapshot \
  -H "x-admin-secret: $ADMIN_SECRET"
```

This endpoint must be called **at the end of each calendar month** (or very shortly after month rollover) to preserve that month's top donors before the next month's donations begin accruing. It is idempotent — re-running for the same month overwrites existing rows.

**Authentication:** The `x-admin-secret` header must match the `ADMIN_SECRET` environment variable. Store this value securely:

- **Kubernetes:** Include `ADMIN_SECRET` in the `.env` file when creating the `greenpay-secrets` Secret (see [Creating secrets from .env](#creating-secrets-from-env)).
- **GitHub Actions:** Store as a [repository secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions) if triggering via a workflow.

**Automation recommendations (pick one):**

1. **Kubernetes CronJob** — Add a CronJob to the cluster that runs the curl command above on the 1st of every month:
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: leaderboard-snapshot
     namespace: greenpay
   spec:
     schedule: "0 1 1 * *"
     jobTemplate:
       spec:
         template:
           spec:
             containers:
             - name: curl
               image: curlimages/curl:latest
               command:
               - /bin/sh
               - -c
               - curl -X POST http://greenpay-backend:4000/api/leaderboard/snapshot -H "x-admin-secret: $ADMIN_SECRET"
             restartPolicy: OnFailure
   ```

2. **Extend `digestQueue.js`** — The monthly digest cron (`backend/src/services/digestQueue.js`) already runs on the 1st of every month via pg-boss. Import and call the snapshot logic from the same worker to colocate both month-end tasks. See the file for integration points.
