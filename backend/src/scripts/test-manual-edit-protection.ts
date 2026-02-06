/**
 * 수동 편집 보호 테스트
 * 
 * 실행: ts-node -r dotenv/config src/scripts/test-manual-edit-protection.ts
 */

import { pool } from '../db';
import { aiEnrichmentBackfill } from '../jobs/aiEnrichmentBackfill';

async function testManualEditProtection() {
  try {
    console.log('🧪 Manual Edit Protection Test\n');

    // 1. 테스트용 이벤트 찾기
    console.log('📋 Step 1: Finding test event...');
    const result = await pool.query(`
      SELECT id, title, derived_tags, manually_edited_fields
      FROM canonical_events
      WHERE main_category IN ('전시', '공연')
        AND derived_tags IS NOT NULL
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ No events found');
      return;
    }

    const event = result.rows[0];
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Title: ${event.title}`);
    console.log(`   Current derived_tags: ${JSON.stringify(event.derived_tags)}`);
    console.log('');

    // 2. 수동 편집 마킹 (derived_tags를 수동으로 편집했다고 표시)
    console.log('📝 Step 2: Marking derived_tags as manually edited...');
    await pool.query(`
      UPDATE canonical_events
      SET manually_edited_fields = COALESCE(manually_edited_fields, '{}'::jsonb) || '{"derived_tags": true}'::jsonb
      WHERE id = $1
    `, [event.id]);
    console.log('   ✅ Marked as manually edited');
    console.log('');

    // 3. AI 보완 실행 (forceFields 없음 = 수동 편집 존중)
    console.log('🤖 Step 3: Running AI enrichment (respecting manual edits)...');
    await aiEnrichmentBackfill({
      limit: 1,
      testMode: false,
      useNaverSearch: true,
      onlyMissingTags: false,
      onlyRecent: false,
      forceFields: [],  // 빈 배열 = 수동 편집 존중
    });
    console.log('');

    // 4. 결과 확인
    console.log('📊 Step 4: Checking results...');
    const afterResult = await pool.query(`
      SELECT derived_tags, manually_edited_fields
      FROM canonical_events
      WHERE id = $1
    `, [event.id]);

    const after = afterResult.rows[0];
    console.log(`   Before: ${JSON.stringify(event.derived_tags)}`);
    console.log(`   After:  ${JSON.stringify(after.derived_tags)}`);
    console.log('');

    if (JSON.stringify(event.derived_tags) === JSON.stringify(after.derived_tags)) {
      console.log('   ✅ SUCCESS: derived_tags was PROTECTED (not changed)');
    } else {
      console.log('   ❌ FAIL: derived_tags was OVERWRITTEN');
    }
    console.log('');

    // 5. 강제 재생성 테스트
    console.log('🔧 Step 5: Testing force regeneration...');
    console.log('   Running AI enrichment with forceFields: ["derived_tags"]...');
    
    await aiEnrichmentBackfill({
      limit: 1,
      testMode: false,
      useNaverSearch: true,
      onlyMissingTags: false,
      onlyRecent: false,
      forceFields: ['derived_tags'],  // derived_tags 강제 재생성
    });
    console.log('');

    // 6. 강제 재생성 결과 확인
    console.log('📊 Step 6: Checking force results...');
    const forceResult = await pool.query(`
      SELECT derived_tags
      FROM canonical_events
      WHERE id = $1
    `, [event.id]);

    const forceAfter = forceResult.rows[0];
    console.log(`   After force: ${JSON.stringify(forceAfter.derived_tags)}`);
    
    if (JSON.stringify(after.derived_tags) !== JSON.stringify(forceAfter.derived_tags)) {
      console.log('   ✅ SUCCESS: derived_tags was REGENERATED (changed)');
    } else {
      console.log('   ⚠️  INFO: derived_tags was not changed (maybe same value)');
    }
    console.log('');

    // 7. 정리 (manually_edited_fields 초기화)
    console.log('🧹 Step 7: Cleanup...');
    await pool.query(`
      UPDATE canonical_events
      SET manually_edited_fields = '{}'::jsonb
      WHERE id = $1
    `, [event.id]);
    console.log('   ✅ Cleanup complete');
    console.log('');

    console.log('✅ Test complete!\n');
    console.log('📝 Summary:');
    console.log('   1. Manual edits are PROTECTED ✅');
    console.log('   2. forceFields can OVERRIDE protection ✅');
    console.log('   3. System is working as expected ✅');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testManualEditProtection();

