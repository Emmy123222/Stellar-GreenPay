# Test stage — devDependencies for jest in docker-compose.test.yml
FROM node:20-alpine AS test

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["npm", "test"]

# 1. Builder Stage
FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# 2. Production Runner Stage
FROM node:26-alpine AS runner

WORKDIR /app

ENV NODE_ENV production

# Copy package files and production dependencies
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Copy source code
COPY . .

EXPOSE 4000

# Run Node.js directly as PID 1 (best practice)
CMD ["node", "src/server.js"]
