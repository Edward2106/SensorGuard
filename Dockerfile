# SensorGuard Container Definition
# Production-ready, non-root Node.js Alpine base

FROM node:22-alpine AS base

WORKDIR /app

# Install curl for container health check
RUN apk add --no-cache curl

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source code and scripts
COPY src ./src
COPY scripts ./scripts

# Use unprivileged node user
USER node

EXPOSE 3000

# Default entrypoint runs the API server
CMD ["node", "src/index.js"]
