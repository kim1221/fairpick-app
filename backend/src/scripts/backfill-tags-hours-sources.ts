/**
 * Backfill script: field_sources for derived_tags and opening_hours
 * 
 * AI enrichment로 생성된 derived_tags와 opening_hours 필드에 대해
 * field_sources를 "AI"로 설정합니다.
 */

import { pool } from '../db';

async function backfillTagsAndHoursSources() {
  console.log('[Backfill] Starting field_sources backfill for derived_tags and opening_hours...\n');

  try {
    await pool.query('BEGIN');

    // derived_tags가 있지만 field_sources가 없는 이벤트 조회
    const tagsResult = await pool.query(`
      SELECT id, title, derived_tags, field_sources
      FROM canonical_events
      WHERE derived_tags IS NOT NULL 
        AND jsonb_array_length(derived_tags) > 0
        AND (field_sources IS NULL OR field_sources->'derived_tags' IS NULL)
    `);

    console.log(`[Backfill] Found ${tagsResult.rows.length} events with derived_tags but no field_sources`);

    let tagsUpdated = 0;
    const timestamp = new Date().toISOString();

    for (const event of tagsResult.rows) {
      const fieldSources = event.field_sources || {};
      fieldSources['derived_tags'] = {
        source: 'AI',
        sourceDetail: 'Gemini extracted tags',
        confidence: 100,
        updatedAt: timestamp,
      };

      await pool.query(
        `UPDATE canonical_events 
         SET field_sources = $1, updated_at = NOW() 
         WHERE id = $2`,
        [fieldSources, event.id]
      );

      tagsUpdated++;

      if (tagsUpdated % 100 === 0) {
        console.log(`[Backfill] Processed ${tagsUpdated} derived_tags...`);
      }
    }

    console.log(`[Backfill] ✅ Updated ${tagsUpdated} events with derived_tags field_sources\n`);

    // opening_hours가 있지만 field_sources가 없는 이벤트 조회
    const hoursResult = await pool.query(`
      SELECT id, title, opening_hours, field_sources
      FROM canonical_events
      WHERE opening_hours IS NOT NULL 
        AND jsonb_typeof(opening_hours) = 'object'
        AND (field_sources IS NULL OR field_sources->'opening_hours' IS NULL)
    `);

    console.log(`[Backfill] Found ${hoursResult.rows.length} events with opening_hours but no field_sources`);

    let hoursUpdated = 0;

    for (const event of hoursResult.rows) {
      const fieldSources = event.field_sources || {};
      fieldSources['opening_hours'] = {
        source: 'AI',
        sourceDetail: 'Gemini extracted opening hours',
        confidence: 100,
        updatedAt: timestamp,
      };

      await pool.query(
        `UPDATE canonical_events 
         SET field_sources = $1, updated_at = NOW() 
         WHERE id = $2`,
        [fieldSources, event.id]
      );

      hoursUpdated++;

      if (hoursUpdated % 100 === 0) {
        console.log(`[Backfill] Processed ${hoursUpdated} opening_hours...`);
      }
    }

    console.log(`[Backfill] ✅ Updated ${hoursUpdated} events with opening_hours field_sources\n`);

    await pool.query('COMMIT');

    // 검증
    const verificationResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE derived_tags IS NOT NULL AND jsonb_array_length(derived_tags) > 0) AS total_with_tags,
        COUNT(*) FILTER (WHERE derived_tags IS NOT NULL AND jsonb_array_length(derived_tags) > 0 AND field_sources->'derived_tags' IS NOT NULL) AS tags_with_sources,
        COUNT(*) FILTER (WHERE opening_hours IS NOT NULL AND jsonb_typeof(opening_hours) = 'object') AS total_with_hours,
        COUNT(*) FILTER (WHERE opening_hours IS NOT NULL AND jsonb_typeof(opening_hours) = 'object' AND field_sources->'opening_hours' IS NOT NULL) AS hours_with_sources
      FROM canonical_events
    `);

    const verification = verificationResult.rows[0];
    console.log('[Backfill] Verification:');
    console.log(`  - Events with derived_tags: ${verification.total_with_tags}`);
    console.log(`  - derived_tags with field_sources: ${verification.tags_with_sources}`);
    console.log(`  - Events with opening_hours: ${verification.total_with_hours}`);
    console.log(`  - opening_hours with field_sources: ${verification.hours_with_sources}`);

    console.log('\n[Backfill] ✅ Backfill complete!');

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('[Backfill] ❌ Transaction failed:', error);
    throw error;
  } finally {
    await pool.end();
    console.log('[Backfill] Done!');
  }
}

backfillTagsAndHoursSources().catch(console.error);

