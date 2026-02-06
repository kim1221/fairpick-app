import { pool } from '../db';

async function test() {
  const result = await pool.query(`
    SELECT id, title, main_category 
    FROM canonical_events 
    WHERE main_category = '축제' AND status IN ('scheduled', 'ongoing') 
    LIMIT 3
  `);
  
  console.log('축제 이벤트:');
  result.rows.forEach(row => {
    console.log(`  ${row.id} | ${row.title} | ${row.main_category}`);
  });
  
  await pool.end();
}

test().catch(console.error);

