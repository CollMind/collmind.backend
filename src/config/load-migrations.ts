/**
 * Dynamically load migration files in production
 * This avoids issues with TypeORM's glob pattern resolution
 */

import { MigrationInterface } from 'typeorm';

export function loadMigrations(): (new () => MigrationInterface)[] {
  console.log('🔍 loadMigrations() called');
  const isProduction = process.env.NODE_ENV === 'production';
  console.log(`🔍 NODE_ENV: ${process.env.NODE_ENV}, isProduction: ${isProduction}`);
  
  const path = require('path');
  const fs = require('fs');

  if (isProduction) {
    // Production: manually require all compiled JS migration files
    const migrationDir = path.join(process.cwd(), 'dist', 'database', 'migrations');
    console.log(`🔍 Migration directory: ${migrationDir}`);
    console.log(`🔍 Migration directory exists: ${fs.existsSync(migrationDir)}`);
    
    if (!fs.existsSync(migrationDir)) {
      console.warn(`⚠️  Migration directory does not exist: ${migrationDir}`);
      return [];
    }

    const allFiles = fs.readdirSync(migrationDir);
    console.log(`🔍 All files in directory: ${allFiles.length}`);
    
    const migrationFiles = allFiles
      .filter((file: string) => file.endsWith('.js') && !file.endsWith('.d.ts') && file !== '.gitkeep' && file !== 'index.js')
      .sort(); // Sort to ensure correct order

    console.log(`📦 Loading ${migrationFiles.length} migration files from ${migrationDir}`);
    if (migrationFiles.length === 0) {
      console.warn(`⚠️  No .js migration files found! All files: ${allFiles.join(', ')}`);
      return [];
    }

    const migrations: (new () => MigrationInterface)[] = [];

    // Load individual files using relative paths from process.cwd()
    // This is more reliable than absolute paths with require()
    for (const file of migrationFiles) {
      try {
        // Calculate relative path from process.cwd() to migration file
        const filePath = path.join(migrationDir, file);
        const relativePath = path.relative(process.cwd(), filePath);
        // Normalize path separators for require()
        const normalizedPath = relativePath.replace(/\\/g, '/');
        // Remove leading ./ if present, require() doesn't need it
        const cleanPath = normalizedPath.startsWith('./') ? normalizedPath.substring(2) : normalizedPath;
        
        console.log(`🔍 Attempting to load: ${file}`);
        console.log(`🔍   Full path: ${filePath}`);
        console.log(`🔍   Relative path: ${cleanPath}`);
        console.log(`🔍   File exists: ${fs.existsSync(filePath)}`);
        
        if (!fs.existsSync(filePath)) {
          console.warn(`   ⚠️  File does not exist: ${filePath}`);
          continue;
        }
        
        // Use Node.js Module API to load the compiled CommonJS file
        // This is more reliable than vm.runInContext for CommonJS modules
        const Module = require('module');
        const originalRequire = Module.prototype.require;
        
        // Create a custom require function that can resolve migration files
        // This bypasses webpack's module resolution
        const migrationModulePath = path.resolve(filePath);
        console.log(`🔍   Loading migration from: ${migrationModulePath}`);
        
        let migrationModule: any;
        try {
          // Use Node.js's native require with absolute path
          // This should work even if webpack doesn't bundle the file
          // We need to clear the require cache first to allow reloading
          delete require.cache[migrationModulePath];
          
          // Try to require the file directly
          // If this fails due to webpack, we'll fall back to vm approach
          try {
            migrationModule = require(migrationModulePath);
            console.log(`   ✅ Successfully loaded migration using require()`);
          } catch (requireError: any) {
            // If require fails (likely due to webpack), use vm.runInThisContext
            console.log(`   ⚠️  require() failed (likely webpack issue), using vm.runInThisContext...`);
            console.log(`   ⚠️  Error: ${requireError?.message}`);
            
            // Read the file content
            const fileContent = fs.readFileSync(filePath, 'utf8');
            console.log(`🔍   Read file content (${fileContent.length} bytes)`);
            
            // Check if file is CommonJS
            const isCommonJS = fileContent.includes('require(') || fileContent.includes('module.exports') || fileContent.includes('exports.');
            console.log(`🔍   File is CommonJS: ${isCommonJS}`);
            
            // If file has ES6 syntax, convert it
            let processedContent = fileContent;
            if (fileContent.includes('import ') || fileContent.includes('export ')) {
              console.log(`🔍   Detected ES6 syntax, converting to CommonJS...`);
              
              // Convert imports
              processedContent = processedContent.replace(
                /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"];?/g,
                (match, imports, moduleName) => {
                  return `const { ${imports.trim()} } = require('${moduleName}');`;
                }
              );
              
              processedContent = processedContent.replace(
                /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
                (match, defaultImport, moduleName) => {
                  return `const ${defaultImport} = require('${moduleName}');`;
                }
              );
              
              // Convert export class
              const classExportRegex = /export\s+class\s+(\w+)/g;
              const classMatches = [...processedContent.matchAll(classExportRegex)];
              if (classMatches.length > 0) {
                processedContent = processedContent.replace(/export\s+class\s+/g, 'class ');
                const classNames = classMatches.map(m => m[1]);
                if (!processedContent.includes('module.exports')) {
                  processedContent += `\nmodule.exports = { ${classNames.join(', ')} };`;
                }
              }
              
              processedContent = processedContent.replace(
                /export\s+default\s+class\s+(\w+)/g,
                (match, className) => `class ${className}`
              );
            }
            
            // Use vm.runInThisContext (not runInContext) - this runs in the current global context
            const vm = require('vm');
            const moduleExports: any = {};
            
            // Create a custom require function
            const customRequire = (moduleName: string) => {
              if (moduleName === 'typeorm') {
                return require('typeorm');
              }
              return require(moduleName);
            };
            
            // Create a fake module object
            const fakeModule = {
              exports: moduleExports,
              require: customRequire,
              filename: filePath,
              dirname: migrationDir,
            };
            
            // Create a wrapper that provides module context
            // This simulates CommonJS module loading
            const wrappedCode = `
              (function(exports, require, module, __filename, __dirname) {
                ${processedContent}
              })(module.exports, require, module, __filename, __dirname);
            `;
            
            // We need to provide these variables in the scope
            // Since runInThisContext uses the current global scope, we can set them temporarily
            const originalModule = global.module;
            const originalExports = global.exports;
            const originalRequire = global.require;
            const originalFilename = global.__filename;
            const originalDirname = global.__dirname;
            
            try {
              // Set global variables for the module context
              (global as any).module = fakeModule;
              (global as any).exports = moduleExports;
              (global as any).require = customRequire;
              (global as any).__filename = filePath;
              (global as any).__dirname = migrationDir;
              
              // Execute in current context (not a sandbox)
              vm.runInThisContext(wrappedCode, {
                filename: filePath,
                displayErrors: true,
              });
              
              migrationModule = moduleExports;
            } finally {
              // Restore original globals
              if (originalModule !== undefined) (global as any).module = originalModule;
              if (originalExports !== undefined) (global as any).exports = originalExports;
              if (originalRequire !== undefined) (global as any).require = originalRequire;
              if (originalFilename !== undefined) (global as any).__filename = originalFilename;
              if (originalDirname !== undefined) (global as any).__dirname = originalDirname;
            }
            console.log(`   ✅ Successfully loaded migration using vm.runInThisContext()`);
          }
        } catch (loadError: any) {
          console.error(`   ❌ Error loading migration: ${loadError?.message}`);
          console.error(`   ❌ Stack: ${loadError?.stack}`);
          throw loadError;
        }
        
        console.log(`🔍 Module loaded, exports: ${Object.keys(migrationModule).join(', ')}`);
        
        // Find the exported class
        // Migration files export classes like: export class CreateTenants1704067200000
        // In compiled JS with CommonJS, this becomes: exports.CreateTenants1704067200000 = class ...
        let MigrationClass: new () => MigrationInterface | null = null;
        
        // Try default export first
        if (migrationModule.default && typeof migrationModule.default === 'function') {
          MigrationClass = migrationModule.default;
          console.log(`🔍 Found default export: ${MigrationClass.name}`);
        } else {
          // Try to find the class in exports (CommonJS exports all classes)
          // Migration class names follow pattern: CreateTenants1704067200000
          const exports = Object.keys(migrationModule);
          console.log(`🔍 Searching ${exports.length} exports for migration class...`);
          
          for (const exportName of exports) {
            // Skip non-class exports
            if (exportName === '__esModule' || exportName === 'default') {
              console.log(`🔍 Skipping export: ${exportName}`);
              continue;
            }
            
            const exported = migrationModule[exportName];
            console.log(`🔍 Checking export "${exportName}": type=${typeof exported}, isFunction=${typeof exported === 'function'}, hasPrototype=${!!exported?.prototype}`);
            
            if (exported && typeof exported === 'function' && exported.prototype) {
              // Check if it implements MigrationInterface (has up and down methods)
              const hasUp = typeof exported.prototype.up === 'function';
              const hasDown = typeof exported.prototype.down === 'function';
              console.log(`🔍 Export "${exportName}": hasUp=${hasUp}, hasDown=${hasDown}`);
              
              if (hasUp && hasDown) {
                MigrationClass = exported;
                console.log(`🔍 Found migration class: ${exportName}`);
                break;
              }
            }
          }
        }

        if (MigrationClass) {
          migrations.push(MigrationClass as new () => MigrationInterface);
          console.log(`   ✅ Loaded: ${file} (${MigrationClass.name})`);
        } else {
          console.warn(`   ⚠️  Could not find migration class in ${file}`);
          console.warn(`   Available exports: ${Object.keys(migrationModule).join(', ')}`);
          // Try to log the structure
          Object.keys(migrationModule).forEach(key => {
            const val = migrationModule[key];
            if (val && typeof val === 'function') {
              console.warn(`   Export "${key}": function, has up: ${typeof val.prototype?.up}, has down: ${typeof val.prototype?.down}`);
            }
          });
        }
      } catch (error: any) {
        console.error(`   ❌ Error loading migration ${file}:`, error?.message || error);
        console.error(`   Stack: ${error?.stack}`);
      }
    }

    console.log(`✅ Successfully loaded ${migrations.length} migrations out of ${migrationFiles.length} files`);
    return migrations;
  } else {
    // Development: return empty array, let TypeORM use glob pattern
    // This is handled by the glob pattern in typeorm.config.ts
    return [];
  }
}
