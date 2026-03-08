# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for argon2/native modules + OpenSSL 3.x for Prisma
RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
RUN npm ci --include=dev

COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ─── Stage 2: Production image ───────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# OpenSSL 3.x required by Prisma query engine (linux-musl-openssl-3.0.x)
RUN apk add --no-cache openssl

# Security: run as non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S genaff -u 1001

# Copy built app and production node_modules
COPY --from=builder --chown=genaff:nodejs /app/dist ./dist
COPY --from=builder --chown=genaff:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=genaff:nodejs /app/package.json ./package.json
COPY --from=builder --chown=genaff:nodejs /app/prisma ./prisma

# Create non-root user
USER genaff

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Start
CMD ["node", "dist/index.js"]
