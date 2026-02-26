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

echo "Running migrations..."
./node_modules/.bin/typeorm migration:run -d dist/config/typeorm.config.js
echo "Migrations completed!"

echo "Running seeds..."
node dist/database/seeds/run-seeds.js
echo "Seeds completed!"

echo "Starting Node.js application..."
exec node dist/main
