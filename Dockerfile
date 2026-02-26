FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN rm -rf dist && npm run build
# Verify migrations were compiled
RUN ls -la dist/database/migrations/ || echo "Warning: No migration files found in dist"

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