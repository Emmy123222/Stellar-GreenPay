const rateLimit = require("express-rate-limit");
const logger = require("../logger");

const createRateLimiter = (maxRequests, windowMinutes) => {
  return rateLimit({
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
};

module.exports = { createRateLimiter };
