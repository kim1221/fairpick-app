import { pool } from '../src/db';

async function checkGeoCount() {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) AS total_with_geo
      FROM canonical_events
      WHERE lat IS NOT NULL AND lng IS NOT NULL
        AND end_at >= CURRENT_DATE;
    `);

    console.log('Total events with geo data:', result.rows[0].total_with_geo);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkGeoCount();
