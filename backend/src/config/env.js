"use strict";
const { z } = require("zod");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.string().optional().default("4000"),
  NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).optional().default("testnet"),
  HORIZON_URL: z.string().url().optional().default("https://horizon-testnet.stellar.org"),
  ALLOWED_ORIGINS: z.string().optional().default("http://localhost:3000"),
  CONTRACT_ID: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().optional().default("GreenPay <updates@greenpay.app>"),
  APP_URL: z.string().optional().default("http://localhost:3000"),
  JWT_SECRET: z.string().optional().default(""),
  ADMIN_USERNAME: z.string().optional().default("admin"),
  ADMIN_PASSWORD: z.string().optional().default(""),
  ADMIN_API_KEY: z.string().optional().default(""),
  ADMIN_API_KEYS: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  REDIS_URL: z.string().optional().default("redis://localhost:6379"),
  ENABLE_TURRETS: z.enum(["true", "false"]).optional().default("false"),
  TURRETS_PORT: z.string().optional().default("3001"),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.errors.map((e) => `  - ${e.path.join(".")}: ${e.message}`).join("\n");
    console.error(`\n[Startup] Environment validation failed:\n${missing}\n`);
    process.exit(1);
  }

  return result.data;
}

module.exports = { validateEnv };
