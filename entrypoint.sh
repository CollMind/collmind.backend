#!/bin/sh
set -e

echo "Running migrations..."
npm run migration:run:prod

echo "Starting server..."
node dist/main