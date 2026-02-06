require('dotenv').config();
const { pool } = require('./src/db');

pool.query(`
  SELECT column_name 
  FROM information_schema.columns 
  WHERE table_name = 'canonical_events' 
  AND column_name = 'buzz_updated_at'
`).then(result => {
  console.log('Result:', result.rows);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
