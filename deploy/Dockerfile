FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir logs && chown node:node logs
COPY src ./src
COPY scripts ./scripts
COPY simulator ./simulator
COPY --from=frontend /build/frontend/dist ./frontend/dist
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
