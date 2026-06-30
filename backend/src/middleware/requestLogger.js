"use strict";
const pinoHttp = require("pino-http");
const { v4: uuid } = require("uuid");
const logger = require("../logger");

module.exports = pinoHttp({
  logger,
  // Read X-Correlation-Id from inbound request or generate a fresh UUID
  genReqId: (req) => req.headers["x-correlation-id"] || uuid(),
  // Surface the request ID field as "correlationId" in log lines
  customAttributeKeys: { reqId: "correlationId" },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        correlationId: req.id,
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
