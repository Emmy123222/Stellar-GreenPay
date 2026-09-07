"use strict";

// Polyfill worker_threads.markAsUncloneable for older Node.js runtimes (e.g. Node 20 < 20.19.0)
// where undici (used by testcontainers) requires this API to construct webidl objects.
const worker_threads = require("node:worker_threads");
if (typeof worker_threads.markAsUncloneable !== "function") {
  worker_threads.markAsUncloneable = () => {};
}
