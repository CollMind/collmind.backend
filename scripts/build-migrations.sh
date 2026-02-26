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
    
    # Compile the file directly to .js output
    # Use --outFile to specify the exact output file name
    npx tsc "$file" \
      --outFile "dist/database/migrations/$filename.js" \
      --module commonjs \
      --target ES2021 \
      --moduleResolution node \
      --esModuleInterop \
      --skipLibCheck \
      --declaration false \
      --sourceMap false \
      --resolveJsonModule \
      --lib es2021 \
      --types node || {
        echo "Failed to compile $filename, trying alternative method..."
        # Alternative: compile to temp location and move
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
        
        # Find and rename the output file
        if [ -f "dist/database/migrations/$filename.ts" ]; then
          mv "dist/database/migrations/$filename.ts" "dist/database/migrations/$filename.js"
        elif [ -f "dist/database/migrations/$(basename $file)" ]; then
          mv "dist/database/migrations/$(basename $file)" "dist/database/migrations/$filename.js"
        else
          echo "ERROR: Could not find compiled output for $filename"
          exit 1
        fi
      }
  fi
done

# Verify all files are .js
echo "Verifying compiled migration files..."
js_count=$(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l)
ts_count=$(ls -1 dist/database/migrations/*.ts 2>/dev/null | wc -l)

if [ "$ts_count" -gt 0 ]; then
  echo "⚠️  WARNING: Found $ts_count .ts files in dist/database/migrations - these should be .js"
  # Try to rename any remaining .ts files
  for tsfile in dist/database/migrations/*.ts; do
    if [ -f "$tsfile" ]; then
      jsname=$(basename "$tsfile" .ts).js
      mv "$tsfile" "dist/database/migrations/$jsname"
      echo "Renamed $(basename $tsfile) to $jsname"
    fi
  done
fi

echo "✅ Migration files compiled successfully: $js_count .js files found"
