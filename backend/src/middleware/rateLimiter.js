const rateLimit = require('express-rate-limit')

/**
 * Factory function to create reusable rate limiters
 * @param {number} maxRequests - max requests allowed
 * @param {number} windowMinutes - time window in minutes
 */
const createRateLimiter = (maxRequests, windowMinutes) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.set('Retry-After', Math.ceil(windowMinutes * 60));
      return res.status(429).json({
        message: 'Too many requests — Try again later.',
      });
    },
  });
};

module.exports = { createRateLimiter };