import { useEffect, useState } from "react";
import Head from "next/head";
import useSWR from "swr";
import { io } from "socket.io-client";
import DegradedBanner from "@/components/DegradedBanner";
import {
  fetchStatusSnapshot,
  type ComponentHealth,
  type IndexerHealth,
  type ServiceState,
  type StatusSnapshot,
} from "@/lib/status";

const STATUS_REFRESH_INTERVAL_MS = 30_000;
const INDEXER_LAG_WARNING_THRESHOLD = 5;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

type WebSocketStatus = ComponentHealth;

const STATUS_STYLES: Record<ServiceState, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  degraded: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100",
  unavailable: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200",
  starting: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
  unknown: "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200",
};

function statusLabel(state: ServiceState): string {
  switch (state) {
    case "healthy": return "Operational";
    case "degraded": return "Degraded";
    case "unavailable": return "Unavailable";
    case "starting": return "Starting";
    default: return "Unknown";
  }
}

function checkedLabel(value: string | null): string {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

function ComponentTile({
  title,
  health,
  detail,
}: {
  title: string;
  health: ComponentHealth;
  detail?: string;
}) {
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-[var(--text)]">{title}</h2>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[health.state]}`}
          aria-live="polite"
        >
          {statusLabel(health.state)}
        </span>
      </div>
      <p className="mt-3 text-sm text-[var(--text-secondary)]">{detail || health.detail}</p>
      <p className="mt-4 text-xs text-[var(--text-tertiary)]">
        Last checked: <time dateTime={health.checkedAt || undefined}>{checkedLabel(health.checkedAt)}</time>
      </p>
    </article>
  );
}

function getIndexerTileHealth(indexer: IndexerHealth): ComponentHealth {
  if (indexer.lagLedgers !== null && indexer.lagLedgers >= INDEXER_LAG_WARNING_THRESHOLD) {
    return { ...indexer, state: "degraded" };
  }
  return indexer;
}

function isDegraded(snapshot: StatusSnapshot | undefined, websocket: WebSocketStatus): boolean {
  if (!snapshot) return false;
  const healthChecks = [snapshot.api, snapshot.database, snapshot.redis, snapshot.indexer, websocket];
  return healthChecks.some(({ state }) =>
    state === "degraded" || state === "unavailable" || state === "unknown")
    || (snapshot.indexer.lagLedgers !== null
      && snapshot.indexer.lagLedgers >= INDEXER_LAG_WARNING_THRESHOLD);
}

export default function StatusPage() {
  const { data, isLoading, isValidating, mutate } = useSWR(
    "status-page",
    fetchStatusSnapshot,
    {
      refreshInterval: STATUS_REFRESH_INTERVAL_MS,
      dedupingInterval: 5000,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  );
  const [websocket, setWebsocket] = useState<WebSocketStatus>({
    state: "starting",
    checkedAt: "",
    detail: "Connecting to the backend WebSocket.",
  });

  useEffect(() => {
    const socket = io(API_URL || undefined, {
      path: "/socket.io",
      transports: ["websocket"],
      timeout: 5000,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    const onConnect = () => setWebsocket({
      state: "healthy",
      checkedAt: new Date().toISOString(),
      detail: "WebSocket connection is open.",
    });
    const onDisconnect = () => setWebsocket({
      state: "unavailable",
      checkedAt: new Date().toISOString(),
      detail: "WebSocket connection is not available.",
    });
    const onConnectError = () => setWebsocket({
      state: "unavailable",
      checkedAt: new Date().toISOString(),
      detail: "Could not connect to the backend WebSocket.",
    });

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    return () => {
      socket.disconnect();
    };
  }, []);

  const indexerHealth = data ? getIndexerTileHealth(data.indexer) : null;
  const degraded = isDegraded(data, websocket);

  return (
    <>
      <Head>
        <title>System Status | Stellar GreenPay</title>
        <meta name="description" content="Live health status for Stellar GreenPay services." />
      </Head>
      <section className="min-h-[70vh] bg-[var(--bg)] px-4 py-12">
        <div className="mx-auto max-w-5xl space-y-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-[var(--green)]">
                System status
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold text-[var(--text)]">
                Stellar GreenPay service health
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Health checks refresh automatically every 30 seconds.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void mutate()}
              disabled={isValidating}
              className="btn-secondary self-start sm:self-auto"
            >
              {isValidating ? "Refreshing..." : "Refresh now"}
            </button>
          </header>

          {degraded && (
            <DegradedBanner
              title={data?.api.state === "unavailable" ? "Backend health data unavailable" : undefined}
              message={data?.api.state === "unavailable"
                ? "The API health endpoint could not be reached. Database and Redis status cannot be confirmed until the API responds."
                : "One or more health checks are degraded or unavailable. The details below show the latest check results."}
            />
          )}

          {isLoading && !data && (
            <p role="status" className="text-sm text-[var(--text-secondary)]">
              Checking service health...
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data ? (
              <>
                <ComponentTile title="API" health={data.api} />
                <ComponentTile title="Database" health={data.database} />
                <ComponentTile title="Redis" health={data.redis} />
                <ComponentTile
                  title="Indexer"
                  health={indexerHealth || data.indexer}
                  detail={data.indexer.lagLedgers === null
                    ? data.indexer.detail
                    : `${data.indexer.lagLedgers} ledger${data.indexer.lagLedgers === 1 ? "" : "s"} behind the network. Warning at ${INDEXER_LAG_WARNING_THRESHOLD} ledgers.`}
                />
              </>
            ) : (
              <>
                {(["API", "Database", "Redis", "Indexer"] as const).map((title) => (
                  <ComponentTile
                    key={title}
                    title={title}
                    health={{
                      state: isLoading ? "starting" : "unavailable",
                      checkedAt: "",
                      detail: isLoading ? "Waiting for the first health check." : "Health information unavailable.",
                    }}
                  />
                ))}
              </>
            )}
            <ComponentTile title="WebSocket" health={websocket} />
          </div>

        </div>
      </section>
    </>
  );
}
