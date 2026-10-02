const rateLimit = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const logger = require("../logger");
const redis = require("../services/redis");

/**
 * Sets X-RateLimit-{Limit,Remaining,Reset} from the req.rateLimit object
 * that express-rate-limit attaches on every request (including allowed ones).
 */
function setRateLimitHeaders(req, res, next) {
  const info = req.rateLimit;
  if (info) {
    res.set("X-RateLimit-Limit", String(info.limit));
    res.set("X-RateLimit-Remaining", String(info.remaining));
    // resetTime is a Date; convert to Unix epoch seconds
    res.set("X-RateLimit-Reset", String(Math.ceil(info.resetTime.getTime() / 1000)));
  }
  next();
}

const { MemoryStore } = require("express-rate-limit");

const memoryStores = new Map();

function getMemoryStore(namespace, windowMs) {
  if (!memoryStores.has(namespace)) {
    const store = new MemoryStore();
    store.init({ windowMs });
    memoryStores.set(namespace, store);
  }
  return memoryStores.get(namespace);
}

function clearMemoryStore(pattern) {
  for (const [namespace, store] of memoryStores.entries()) {
    if (!pattern || pattern.includes(namespace)) {
      if (typeof store.resetAll === "function") {
        store.resetAll();
      }
    }
  }
}

class FallbackStore {
  constructor(redisStore, memoryStore) {
    this.redisStore = redisStore;
    this.memoryStore = memoryStore;
  }

  async init(options) {
    if (this.memoryStore && typeof this.memoryStore.init === "function") {
      this.memoryStore.init(options);
    }
    if (redis.client.status === "ready" && this.redisStore && typeof this.redisStore.init === "function") {
      try {
        await this.redisStore.init(options);
      } catch {
        // Fall back to memory store
      }
    }
  }

  async get(key) {
    if (redis.client.status === "ready") {
      try {
        return await this.redisStore.get(key);
      } catch {
        // Fall back to memory store
      }
    }
    return this.memoryStore.get(key);
  }

  async increment(key) {
    if (redis.client.status === "ready") {
      try {
        return await this.redisStore.increment(key);
      } catch {
        // Fall back to memory store
      }
    }
    return this.memoryStore.increment(key);
  }

  async decrement(key) {
    if (redis.client.status === "ready") {
      try {
        return await this.redisStore.decrement(key);
      } catch {
        // Fall back to memory store
      }
    }
    return this.memoryStore.decrement(key);
  }

  async resetKey(key) {
    if (redis.client.status === "ready") {
      try {
        await this.redisStore.resetKey(key);
      } catch {
        // Fall back to memory store
      }
    }
    await this.memoryStore.resetKey(key);
  }

  async resetAll() {
    if (redis.client.status === "ready") {
      try {
        if (typeof this.redisStore.resetAll === "function") {
          await this.redisStore.resetAll();
        }
      } catch {
        // Fall back to memory store
      }
    }
    if (typeof this.memoryStore.resetAll === "function") {
      await this.memoryStore.resetAll();
    }
  }
}

const createRateLimiter = (maxRequests, windowMinutes, namespace) => {
  const limiterNamespace = namespace || `${maxRequests}-${windowMinutes}`;
  const windowMs = windowMinutes * 60 * 1000;
  const redisStore = new RedisStore({
    prefix: `greenpay:rate-limit:${limiterNamespace}:`,
    sendCommand: (...args) => redis.sendCommand(...args),
  });
  const memStore = getMemoryStore(limiterNamespace, windowMs);
  const store = new FallbackStore(redisStore, memStore);

  const limiter = rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    store,
    handler: (req, res) => {
      (req.log || logger).warn({
        event: "rate_limit_hit",
        ip: req.ip,
        path: req.path,
        method: req.method,
        limit: maxRequests,
        windowMinutes,
      }, "Rate limit exceeded");
      res.set("Retry-After", Math.ceil(windowMinutes * 60));
      return res.status(429).json({
        message: "Too many requests — Try again later.",
      });
    },
  });

  // Return both middleware in order: limiter first (populates req.rateLimit),
  // then the header setter. Express flattens middleware arrays automatically.
  return [limiter, setRateLimitHeaders];
};

module.exports = { createRateLimiter, clearMemoryStore };
