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
        
        // Use fs.readFileSync + vm.runInThisContext instead of require()
        // This works because webpack doesn't bundle migration files
        const vm = require('vm');
        let fileContent = fs.readFileSync(filePath, 'utf8');
        console.log(`🔍   Read file content (${fileContent.length} bytes)`);
        
        // Convert ES6 import statements to CommonJS require
        // Migration files may have ES6 imports even though they should be CommonJS
        fileContent = fileContent.replace(
          /import\s+{([^}]+)}\s+from\s+['"]([^'"]+)['"];?/g,
          (match, imports, moduleName) => {
            const cleanImports = imports.trim();
            return `const { ${cleanImports} } = require('${moduleName}');`;
          }
        );
        
        // Convert: import X from 'module' -> const X = require('module').default || require('module')
        fileContent = fileContent.replace(
          /import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?/g,
          (match, defaultImport, moduleName) => {
            return `const ${defaultImport} = require('${moduleName}');`;
          }
        );
        
        // Remove export keyword from class declarations and add to module.exports
        const classExportMatches = fileContent.match(/export\s+class\s+(\w+)/g);
        if (classExportMatches) {
          // Remove export keyword
          fileContent = fileContent.replace(/export\s+class\s+/g, 'class ');
          
          // Extract class names
          const classNames = classExportMatches.map(match => match.replace(/export\s+class\s+/, ''));
          
          // Add module.exports at the end if not already present
          if (!fileContent.includes('module.exports')) {
            fileContent += `\nmodule.exports = { ${classNames.join(', ')} };`;
          } else {
            // Update existing module.exports
            const existingExports = fileContent.match(/module\.exports\s*=\s*{([^}]+)}/);
            if (existingExports) {
              const existing = existingExports[1].trim();
              fileContent = fileContent.replace(
                /module\.exports\s*=\s*{([^}]+)}/,
                `module.exports = { ${existing}, ${classNames.join(', ')} }`
              );
            }
          }
        }
        
        console.log(`🔍   Converted ES6 to CommonJS`);
        
        // Create a module-like context with TypeORM
        const moduleExports: any = {};
        const typeorm = require('typeorm');
        const moduleContext = vm.createContext({
          module: { exports: moduleExports },
          exports: moduleExports,
          require: (moduleName: string) => {
            // Handle typeorm imports
            if (moduleName === 'typeorm') {
              return typeorm;
            }
            // For other modules, use regular require
            return require(moduleName);
          },
          __dirname: migrationDir,
          __filename: filePath,
          console: console,
          process: process,
          Buffer: Buffer,
          global: global,
          setTimeout: setTimeout,
          clearTimeout: clearTimeout,
          setInterval: setInterval,
          clearInterval: clearInterval,
        });
        
        // Execute the converted migration file in the context
        let migrationModule;
        try {
          vm.runInContext(fileContent, moduleContext, { filename: filePath });
          migrationModule = moduleExports;
          console.log(`   ✅ Successfully executed converted migration file`);
        } catch (vmError: any) {
          console.error(`   ❌ VM execution error: ${vmError?.message}`);
          console.error(`   ❌ Stack: ${vmError?.stack}`);
          // Log first few lines for debugging
          const lines = fileContent.split('\n').slice(0, 5);
          console.error(`   ❌ First 5 lines of converted content:`);
          lines.forEach((line, i) => console.error(`      ${i + 1}: ${line}`));
          throw vmError;
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
