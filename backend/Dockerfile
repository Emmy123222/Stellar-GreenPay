# Test stage — devDependencies for jest in docker-compose.test.yml
FROM node:20-alpine AS test

RUN addgroup -S greenpay && adduser -S greenpay -G greenpay

WORKDIR /app

COPY --chown=greenpay:greenpay package*.json ./
RUN npm ci && chown -R greenpay:greenpay /app/node_modules

COPY --chown=greenpay:greenpay . .

USER greenpay

CMD ["npm", "test"]

# 1. Builder Stage
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# 2. Production Runner Stage
FROM node:26-alpine AS runner

RUN addgroup -S greenpay && adduser -S greenpay -G greenpay

WORKDIR /app

ENV NODE_ENV production

# Copy package files and production dependencies
COPY --chown=greenpay:greenpay package*.json ./
COPY --from=builder --chown=greenpay:greenpay /app/node_modules ./node_modules

# Copy source code
COPY --chown=greenpay:greenpay . .

EXPOSE 4000

USER greenpay

# Run Node.js directly as PID 1 (best practice)
CMD ["node", "src/server.js"]
