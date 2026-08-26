const rateLimit = require("express-rate-limit");
const logger = require("../logger");

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

const createRateLimiter = (maxRequests, windowMinutes) => {
  const limiter = rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
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

module.exports = { createRateLimiter };
