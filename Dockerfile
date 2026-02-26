FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Make build script executable
RUN chmod +x scripts/build-migrations.sh 2>/dev/null || true
RUN rm -rf dist && npm run build
# Verify migrations were compiled
RUN echo "Checking for compiled migration files..." && \
    if [ -d "dist/database/migrations" ]; then \
      echo "Migration directory exists:" && \
      ls -la dist/database/migrations/ | head -10; \
      js_count=$(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l); \
      ts_count=$(ls -1 dist/database/migrations/*.ts 2>/dev/null | wc -l); \
      echo "Total .js migration files: $js_count"; \
      echo "Total .ts files (should be 0): $ts_count"; \
      if [ "$js_count" -eq 0 ]; then \
        echo "ERROR: No .js migration files found!" && \
        exit 1; \
      fi; \
      if [ "$ts_count" -gt 0 ]; then \
        echo "WARNING: Found .ts files in dist - these should be .js"; \
      fi; \
    else \
      echo "ERROR: Migration directory does not exist!" && \
      exit 1; \
    fi

FROM node:20-alpine
WORKDIR /app

# bcrypt için gerekli build araçları
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 3000
CMD ["./entrypoint.sh"]