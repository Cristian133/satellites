# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY vendor/ ./vendor/
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY vendor/ ./vendor/
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
RUN mkdir -p data

EXPOSE 3000
CMD ["node", "dist/server.js"]
