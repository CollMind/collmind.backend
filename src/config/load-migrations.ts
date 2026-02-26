/**
 * Dynamically load migration files in production
 * This avoids issues with TypeORM's glob pattern resolution
 */

import { MigrationInterface } from 'typeorm';

export function loadMigrations(): (new () => MigrationInterface)[] {
  const isProduction = process.env.NODE_ENV === 'production';
  const path = require('path');
  const fs = require('fs');

  if (isProduction) {
    // Production: manually require all compiled JS migration files
    const migrationDir = path.join(process.cwd(), 'dist', 'database', 'migrations');
    
    if (!fs.existsSync(migrationDir)) {
      console.warn(`⚠️  Migration directory does not exist: ${migrationDir}`);
      return [];
    }

    const migrationFiles = fs.readdirSync(migrationDir)
      .filter((file: string) => file.endsWith('.js') && !file.endsWith('.d.ts'))
      .sort(); // Sort to ensure correct order

    console.log(`📦 Loading ${migrationFiles.length} migration files from ${migrationDir}`);

    const migrations: (new () => MigrationInterface)[] = [];

    for (const file of migrationFiles) {
      try {
        const migrationPath = path.join(migrationDir, file);
        // Clear require cache to ensure fresh load
        delete require.cache[require.resolve(migrationPath)];
        
        // Require the migration file
        const migrationModule = require(migrationPath);
        
        // Find the exported class
        // Migration files export classes like: export class CreateTenants1704067200000
        // In compiled JS, this becomes: exports.CreateTenants1704067200000 = class ...
        let MigrationClass: new () => MigrationInterface | null = null;
        
        // Try default export first
        if (migrationModule.default && typeof migrationModule.default === 'function') {
          MigrationClass = migrationModule.default;
        } else {
          // Try to find the class in exports (CommonJS exports all classes)
          // Migration class names follow pattern: CreateTenants1704067200000
          const exports = Object.keys(migrationModule);
          for (const exportName of exports) {
            // Skip non-class exports
            if (exportName === '__esModule' || exportName === 'default') continue;
            
            const exported = migrationModule[exportName];
            if (exported && typeof exported === 'function' && exported.prototype) {
              // Check if it implements MigrationInterface (has up and down methods)
              if (typeof exported.prototype.up === 'function' && 
                  typeof exported.prototype.down === 'function') {
                MigrationClass = exported;
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
        }
      } catch (error: any) {
        console.error(`   ❌ Error loading migration ${file}:`, error?.message || error);
      }
    }

    console.log(`✅ Successfully loaded ${migrations.length} migrations`);
    return migrations;
  } else {
    // Development: return empty array, let TypeORM use glob pattern
    // This is handled by the glob pattern in typeorm.config.ts
    return [];
  }
}
