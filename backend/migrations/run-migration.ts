/**
 * SQL 마이그레이션 실행 스크립트
 * 
 * 사용법:
 * ts-node migrations/run-migration.ts <파일명>.sql
 * 
 * 예:
 * ts-node migrations/run-migration.ts 20260206_add_buzz_score_infrastructure.sql
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration(filename: string) {
  console.log('================================================');
  console.log(`Running migration: ${filename}`);
  console.log('================================================');
  console.log('');
  
  try {
    // SQL 파일 읽기
    const filepath = path.join(__dirname, filename);
    
    if (!fs.existsSync(filepath)) {
      throw new Error(`Migration file not found: ${filepath}`);
    }
    
    const sql = fs.readFileSync(filepath, 'utf8');
    
    console.log('SQL 내용:');
    console.log('---');
    console.log(sql);
    console.log('---');
    console.log('');
    
    // 실행
    console.log('실행 중...');
    await pool.query(sql);
    
    console.log('');
    console.log('✅ 마이그레이션 성공!');
    console.log('');
    
  } catch (error: any) {
    console.error('');
    console.error('❌ 마이그레이션 실패:');
    console.error(error.message);
    console.error('');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 실행
const filename = process.argv[2];

if (!filename) {
  console.error('사용법: ts-node migrations/run-migration.ts <파일명>.sql');
  process.exit(1);
}

runMigration(filename);
