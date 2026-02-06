/**
 * Migration 실행 스크립트
 * Usage: ts-node -r dotenv/config src/scripts/run-migration.ts <migration-file>
 */

import { pool } from '../db';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration(migrationFile: string) {
  const migrationPath = path.resolve(__dirname, '../../migrations', migrationFile);
  
  console.log('[Migration] Running:', migrationFile);
  console.log('[Migration] Path:', migrationPath);
  
  if (!fs.existsSync(migrationPath)) {
    console.error('[Migration] ❌ File not found:', migrationPath);
    process.exit(1);
  }
  
  const sql = fs.readFileSync(migrationPath, 'utf8');
  
  try {
    await pool.query(sql);
    console.log('[Migration] ✅ Success:', migrationFile);
  } catch (error: any) {
    console.error('[Migration] ❌ Failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('[Migration] Usage: ts-node -r dotenv/config src/scripts/run-migration.ts <migration-file>');
  console.error('[Migration] Example: ts-node -r dotenv/config src/scripts/run-migration.ts 20260131_add_ai_suggestions.sql');
  process.exit(1);
}

runMigration(migrationFile);

