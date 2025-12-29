import { pool } from '../src/db';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration(filename: string) {
  console.log(`[Migration] Running: ${filename}`);
  
  try {
    const sqlPath = path.join(__dirname, filename);
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    await pool.query(sql);
    
    console.log(`[Migration] ✓ Successfully completed: ${filename}`);
  } catch (error) {
    console.error(`[Migration] ✗ Failed: ${filename}`, error);
    throw error;
  }
}

async function main() {
  const migrationFile = process.argv[2];
  
  if (!migrationFile) {
    console.error('Usage: ts-node migrations/run-migration.ts <migration-file.sql>');
    process.exit(1);
  }
  
  try {
    await runMigration(migrationFile);
    console.log('[Migration] All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    process.exit(1);
  }
}

main();
