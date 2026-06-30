"use strict";

const { z } = require("zod");

function containsHtml(value) {
  return /<[^>]+>/i.test(value || "");
}

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizedStringField({ required = false, minLength = 1, maxLength, message = "must not contain HTML" } = {}) {
  let schema = z.string().trim().refine((value) => !containsHtml(value), { message });

  if (maxLength) {
    schema = schema.refine((value) => value.length <= maxLength, { message: `must be at most ${maxLength} characters` });
  }

  if (required) {
    schema = schema.refine((value) => value.length >= minLength, { message: `must be at least ${minLength} characters` });
  }

  schema = schema.transform((value) => stripHtml(value));

  if (!required) {
    schema = schema.optional();
  }

  return schema;
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) {
        const path = issue.path.length ? issue.path.join(".") : "body";
        details[path] = issue.message;
      }

      return res.status(422).json({ error: "Validation failed", details });
    }

    req.body = result.data;
    next();
  };
}

module.exports = {
  containsHtml,
  sanitizedStringField,
  stripHtml,
  validateBody,
};
