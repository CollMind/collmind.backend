#!/bin/sh
set -e

echo "Building migration files..."

# Create output directory
mkdir -p dist/database/migrations

# Compile each migration file
for file in src/database/migrations/*.ts; do
  if [ -f "$file" ]; then
    filename=$(basename "$file" .ts)
    echo "Compiling $filename..."
    
    # Compile the file
    npx tsc "$file" \
      --outDir dist/database/migrations \
      --module commonjs \
      --target ES2021 \
      --moduleResolution node \
      --esModuleInterop \
      --skipLibCheck \
      --declaration false \
      --sourceMap false \
      --resolveJsonModule \
      --rootDir src/database/migrations
    
    # Rename .ts to .js if needed
    if [ -f "dist/database/migrations/$filename.ts" ]; then
      mv "dist/database/migrations/$filename.ts" "dist/database/migrations/$filename.js"
    elif [ -f "dist/database/migrations/$(basename $file)" ]; then
      mv "dist/database/migrations/$(basename $file)" "dist/database/migrations/$filename.js"
    fi
  fi
done

echo "✅ Migration files compiled successfully"
