#!/bin/sh
set -e

echo "Building migration files..."

# Create output directory
mkdir -p dist/database/migrations

# Compile all migration files at once using --outDir
# This is more efficient and avoids --outFile issues with commonjs
echo "Compiling all migration files..."
npx tsc src/database/migrations/*.ts \
  --outDir dist/database/migrations \
  --module commonjs \
  --target ES2021 \
  --moduleResolution node \
  --esModuleInterop \
  --skipLibCheck \
  --declaration false \
  --sourceMap false \
  --resolveJsonModule \
  --rootDir src/database/migrations \
  --lib es2021 \
  --types node

# Rename all .ts files to .js in the output directory
echo "Renaming .ts files to .js..."
for tsfile in dist/database/migrations/*.ts; do
  if [ -f "$tsfile" ]; then
    jsname=$(basename "$tsfile" .ts).js
    mv "$tsfile" "dist/database/migrations/$jsname"
  fi
done

# Verify all files are .js
echo "Verifying compiled migration files..."
js_count=$(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l)
ts_count=$(ls -1 dist/database/migrations/*.ts 2>/dev/null | wc -l)

if [ "$ts_count" -gt 0 ]; then
  echo "⚠️  WARNING: Found $ts_count .ts files in dist/database/migrations - renaming..."
  for tsfile in dist/database/migrations/*.ts; do
    if [ -f "$tsfile" ]; then
      jsname=$(basename "$tsfile" .ts).js
      mv "$tsfile" "dist/database/migrations/$jsname"
      echo "Renamed $(basename $tsfile) to $jsname"
    fi
  done
  js_count=$(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l)
fi

if [ "$js_count" -eq 0 ]; then
  echo "❌ ERROR: No .js migration files found after compilation!"
  exit 1
fi

echo "✅ Migration files compiled successfully: $js_count .js files found"
