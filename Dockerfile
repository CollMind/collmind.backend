FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN rm -rf dist && npm run build
# Verify migrations were compiled
RUN echo "Checking for compiled migration files..." && \
    if [ -d "dist/database/migrations" ]; then \
      echo "Migration directory exists:" && \
      ls -la dist/database/migrations/ | head -10; \
      echo "Total migration files: $(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l)"; \
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