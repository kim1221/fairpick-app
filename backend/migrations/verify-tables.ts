import { pool } from '../src/db';

async function verifyTables() {
  console.log('[Verify] Checking migration results...\n');
  
  // 1. collection_logs 테이블 확인
  const collectionLogsCheck = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'collection_logs'
    ORDER BY ordinal_position;
  `);
  console.log('✓ collection_logs table:');
  console.log(`  Columns: ${collectionLogsCheck.rows.length}`);
  collectionLogsCheck.rows.forEach(row => {
    console.log(`  - ${row.column_name} (${row.data_type})`);
  });
  
  // 2. event_change_logs 테이블 확인
  const eventChangeLogsCheck = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'event_change_logs'
    ORDER BY ordinal_position;
  `);
  console.log('\n✓ event_change_logs table:');
  console.log(`  Columns: ${eventChangeLogsCheck.rows.length}`);
  eventChangeLogsCheck.rows.forEach(row => {
    console.log(`  - ${row.column_name} (${row.data_type})`);
  });
  
  // 3. canonical_events soft delete 컬럼 확인
  const softDeleteCheck = await pool.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'canonical_events' 
      AND column_name IN ('is_deleted', 'deleted_at', 'deleted_reason')
    ORDER BY column_name;
  `);
  console.log('\n✓ canonical_events soft delete columns:');
  softDeleteCheck.rows.forEach(row => {
    console.log(`  - ${row.column_name} (${row.data_type})`);
  });
  
  // 4. 인덱스 확인
  const indexCheck = await pool.query(`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND (
        indexname LIKE 'idx_collection_logs_%'
        OR indexname LIKE 'idx_event_change_logs_%'
        OR indexname IN ('idx_canonical_events_is_deleted', 'idx_canonical_events_updated_at', 'idx_canonical_events_deleted_at')
      )
    ORDER BY tablename, indexname;
  `);
  console.log(`\n✓ Indexes created: ${indexCheck.rows.length}`);
  indexCheck.rows.forEach(row => {
    console.log(`  - ${row.indexname} on ${row.tablename}`);
  });
  
  console.log('\n[Verify] Migration verification completed successfully!');
}

async function main() {
  try {
    await verifyTables();
    process.exit(0);
  } catch (error) {
    console.error('[Verify] Verification failed:', error);
    process.exit(1);
  }
}

main();
