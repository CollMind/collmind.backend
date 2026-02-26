#!/bin/sh
# Don't exit on error immediately - we want to see what's happening
set -e

echo "Building migration files..."

# Create output directory
mkdir -p dist/database/migrations

# Clean up any .ts files that might have been copied by nest build as assets
# (nest-cli.json should not include migrations as assets, but just in case)
echo "Cleaning up any .ts files in dist/database/migrations..."
rm -f dist/database/migrations/*.ts 2>/dev/null || true

# Compile all migration files using tsconfig.migrations.json
# This ensures TypeScript compiler outputs .js files correctly
echo "Compiling all migration files..."
echo "Using tsconfig.migrations.json from: $(pwd)"
echo "Source files: $(ls -1 src/database/migrations/*.ts 2>/dev/null | wc -l) .ts files found"

# Compile with verbose output to see what's happening
echo "Running TypeScript compiler..."
if npx tsc --project tsconfig.migrations.json 2>&1; then
  echo "✅ TypeScript compilation completed successfully"
else
  echo "⚠️  TypeScript compilation completed with warnings/errors (checking output anyway...)"
fi

echo "Compilation completed. Checking output..."
ls -la dist/database/migrations/*.js 2>/dev/null | head -5 || echo "No .js files found in dist/database/migrations"

# Verify all files are .js (tsc should output .js directly)
echo "Verifying compiled migration files..."
js_count=$(ls -1 dist/database/migrations/*.js 2>/dev/null | wc -l)
ts_count=$(ls -1 dist/database/migrations/*.ts 2>/dev/null | wc -l)

if [ "$ts_count" -gt 0 ]; then
  echo "❌ ERROR: Found $ts_count .ts files in dist/database/migrations!"
  echo "   TypeScript compiler should output .js files directly."
  echo "   This indicates a configuration issue."
  exit 1
fi

if [ "$js_count" -eq 0 ]; then
  echo "❌ ERROR: No .js migration files found after compilation!"
  exit 1
fi

# Verify that compiled files are in CommonJS format (should have require() or module.exports)
echo "Verifying CommonJS format..."
first_js_file=$(ls -1 dist/database/migrations/*.js 2>/dev/null | head -1)
if [ -n "$first_js_file" ]; then
  if grep -q "require\|module\.exports\|exports\." "$first_js_file" 2>/dev/null; then
    echo "✅ Compiled files appear to be in CommonJS format"
  else
    echo "⚠️  WARNING: Compiled files may not be in CommonJS format (no require/module.exports found)"
    echo "   First few lines of $first_js_file:"
    head -5 "$first_js_file" | sed 's/^/   /'
  fi
  
  # Verify that compiled files do NOT contain TypeScript syntax (implements, etc.)
  echo "Verifying no TypeScript syntax in compiled files..."
  if grep -q "implements MigrationInterface" "$first_js_file" 2>/dev/null; then
    echo "❌ ERROR: Found TypeScript syntax (implements) in compiled JS file: $first_js_file"
    echo "   This indicates the file was not properly compiled."
    exit 1
  fi
  echo "✅ No TypeScript syntax found in compiled files"
fi

# List migration files for verification
echo "Listing compiled migration files:"
ls -la dist/database/migrations/*.js | head -5

echo "✅ Migration files compiled successfully: $js_count .js files found"
