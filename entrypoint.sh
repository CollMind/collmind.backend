#!/bin/sh
set -e

echo "=========================================="
echo "Starting CollMind Backend Server"
echo "=========================================="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"
echo "Environment: ${NODE_ENV:-not set}"
echo "Port: ${PORT:-3000}"
echo "=========================================="

# Check if dist/main.js exists
if [ ! -f "dist/main.js" ]; then
  echo "ERROR: dist/main.js not found!"
  echo "Listing dist directory:"
  ls -la dist/ || echo "dist directory does not exist"
  exit 1
fi

# Verify required files exist
echo "Verifying required files..."
if [ ! -f "dist/config/typeorm.config.js" ]; then
  echo "ERROR: dist/config/typeorm.config.js not found!"
  exit 1
fi
echo "✅ dist/config/typeorm.config.js found"

if [ ! -d "dist/database/migrations" ]; then
  echo "ERROR: dist/database/migrations directory not found!"
  exit 1
fi
migration_count=$(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l)
echo "✅ Found $migration_count migration files in dist/database/migrations"

# Optional: Run migrations before starting the app
if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  echo "=========================================="
  echo "Running database migrations..."
  echo "=========================================="
  if npm run migration:run:prod; then
    echo "✅ Migrations completed successfully"
  else
    echo "❌ Migration failed!"
    exit 1
  fi
  echo "=========================================="
else
  echo "ℹ️  Skipping migrations (RUN_MIGRATIONS not set to 'true')"
  echo "   To run migrations on startup, set RUN_MIGRATIONS=true"
fi

echo "Starting Node.js application..."
exec node dist/main