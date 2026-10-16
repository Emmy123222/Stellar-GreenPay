export type ServiceState =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "starting"
  | "unknown";

export interface ComponentHealth {
  state: ServiceState;
  checkedAt: string;
  detail: string;
}

export interface IndexerHealth extends ComponentHealth {
  lagLedgers: number | null;
}

export interface StatusSnapshot {
  api: ComponentHealth;
  database: ComponentHealth;
  redis: ComponentHealth;
  indexer: IndexerHealth;
}

interface HealthPayload {
  status: string;
  timestamp?: string;
  checks?: {
    db?: unknown;
    redis?: unknown;
  };
}

interface IndexerPayload {
  status: string;
  timestamp?: string;
  lagLedgers?: unknown;
}

const HEALTH_REQUEST_TIMEOUT_MS = 5000;
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function timestampOrNow(value: unknown): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return value;
  }
  return new Date().toISOString();
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 503) {
      throw new Error("Health endpoint returned an unexpected status");
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHealth(): Promise<HealthPayload> {
  const value: unknown = await fetchJson(`${API_BASE}/health`);
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("Health endpoint returned an invalid response");
  }
  const checks = isRecord(value.checks) ? value.checks : undefined;
  return {
    status: value.status,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    checks: checks
      ? {
          db: checks.db,
          redis: checks.redis,
        }
      : undefined,
  };
}

async function fetchIndexerHealth(): Promise<IndexerPayload> {
  const value: unknown = await fetchJson(`${API_BASE}/api/indexer/health`);
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("Indexer health endpoint returned an invalid response");
  }
  return {
    status: value.status,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    lagLedgers: value.lagLedgers,
  };
}

function stateFromCheck(value: unknown): ServiceState {
  if (value === "ok") return "healthy";
  if (value === "unreachable" || value === "unavailable") return "unavailable";
  if (value === "alert" || value === "degraded") return "degraded";
  if (value === "starting") return "starting";
  return "unknown";
}

function unavailableCheck(detail: string, checkedAt: string): ComponentHealth {
  return { state: "unavailable", checkedAt, detail };
}

export async function fetchStatusSnapshot(): Promise<StatusSnapshot> {
  const [healthResult, indexerResult] = await Promise.allSettled([
    fetchHealth(),
    fetchIndexerHealth(),
  ]);
  const checkedAt = new Date().toISOString();

  let api: ComponentHealth;
  let database: ComponentHealth;
  let redis: ComponentHealth;
  if (healthResult.status === "fulfilled") {
    const health = healthResult.value;
    const apiState = health.status === "ok" ? "healthy" : stateFromCheck(health.status);
    const healthCheckedAt = timestampOrNow(health.timestamp);
    api = {
      state: apiState,
      checkedAt: healthCheckedAt,
      detail: apiState === "healthy"
        ? "Backend health endpoint is responding."
        : "Backend is responding with degraded health.",
    };
    database = {
      state: stateFromCheck(health.checks?.db),
      checkedAt: healthCheckedAt,
      detail: health.checks?.db === "ok"
        ? "Database connection is responding."
        : "Database health check is not healthy.",
    };
    redis = {
      state: stateFromCheck(health.checks?.redis),
      checkedAt: healthCheckedAt,
      detail: health.checks?.redis === "ok"
        ? "Redis connection is responding."
        : "Redis health check is not healthy.",
    };
  } else {
    api = unavailableCheck("Backend health endpoint could not be reached.", checkedAt);
    database = unavailableCheck("Database status is unavailable while the API is down.", checkedAt);
    redis = unavailableCheck("Redis status is unavailable while the API is down.", checkedAt);
  }

  let indexer: IndexerHealth;
  if (indexerResult.status === "fulfilled") {
    const result = indexerResult.value;
    const state = stateFromCheck(result.status);
    const lagLedgers = typeof result.lagLedgers === "number"
      && Number.isSafeInteger(result.lagLedgers)
      && result.lagLedgers >= 0
      ? result.lagLedgers
      : null;
    indexer = {
      state,
      checkedAt: timestampOrNow(result.timestamp),
      lagLedgers,
      detail: lagLedgers === null
        ? result.status === "starting"
          ? "Waiting for the indexer to process its first ledger."
          : "Indexer lag could not be determined."
        : `${lagLedgers} ledger${lagLedgers === 1 ? "" : "s"} behind the network.`,
    };
  } else {
    indexer = {
      ...unavailableCheck("Indexer health endpoint could not be reached.", checkedAt),
      lagLedgers: null,
    };
  }

  return { api, database, redis, indexer };
}
