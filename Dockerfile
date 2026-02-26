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
        echo "ERROR: Found .ts files in dist - these should be .js!" && \
        exit 1; \
      fi; \
      echo "Verifying migration files do not contain TypeScript syntax..." && \
      first_migration=$(ls -1 dist/database/migrations/*.js 2>/dev/null | head -1) && \
      if [ -n "$first_migration" ]; then \
        if grep -q "implements MigrationInterface" "$first_migration" 2>/dev/null; then \
          echo "ERROR: Found TypeScript syntax (implements) in compiled JS file: $first_migration" && \
          echo "First 10 lines of file:" && \
          head -10 "$first_migration" && \
          exit 1; \
        else \
          echo "✅ Migration files are properly compiled (no TypeScript syntax found)"; \
        fi; \
      fi; \
    else \
      echo "ERROR: Migration directory does not exist!" && \
      exit 1; \
    fi && \
    echo "Checking for compiled seed files..." && \
    if [ ! -f "dist/database/seeds/run-seeds.js" ]; then \
      echo "ERROR: dist/database/seeds/run-seeds.js not found!" && \
      echo "Seed files must be compiled to JavaScript for production." && \
      exit 1; \
    else \
      echo "✅ Seed file found: dist/database/seeds/run-seeds.js"; \
    fi && \
    echo "Checking for typeorm.config.js..." && \
    if [ ! -f "dist/config/typeorm.config.js" ]; then \
      echo "ERROR: dist/config/typeorm.config.js not found!" && \
      echo "TypeORM config file must be compiled to JavaScript for production." && \
      exit 1; \
    else \
      echo "✅ TypeORM config found: dist/config/typeorm.config.js"; \
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