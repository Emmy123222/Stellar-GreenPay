# Observability

## Sentry sampling

GreenPay sends 5% of performance traces to Sentry through `tracesSampleRate: 0.05`.
This limits trace volume and cost under production traffic while preserving useful
latency and transaction visibility.

Error events remain fully sampled with `sampleRate: 1.0`. Errors are therefore
not dropped by the performance-trace sampling budget. The same policy is applied
to the backend and both Next.js Sentry runtimes.

When changing these values, review Sentry event volume and error coverage together;
raising `tracesSampleRate` does not improve error-event capture.
