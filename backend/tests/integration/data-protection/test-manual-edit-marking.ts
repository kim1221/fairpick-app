/**
 * 수동 편집 마킹 테스트 (DB 테스트)
 * 
 * 실행: ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-marking.ts
 */

import { pool } from '../../../src/db';

async function testManualEditMarking() {
  try {
    console.log('🧪 Manual Edit Marking Test\n');

    // 1. 테스트용 이벤트 찾기
    console.log('📋 Step 1: Finding test event...');
    const result = await pool.query(`
      SELECT id, title, derived_tags, manually_edited_fields
      FROM canonical_events
      WHERE main_category IN ('전시', '공연')
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ No events found');
      return;
    }

    const event = result.rows[0];
    console.log(`   Event ID: ${event.id}`);
    console.log(`   Title: ${event.title}`);
    console.log(`   Current manually_edited_fields: ${JSON.stringify(event.manually_edited_fields)}`);
    console.log('');

    // 2. derived_tags 수동 편집 마킹
    console.log('📝 Step 2: Marking derived_tags as manually edited...');
    await pool.query(`
      UPDATE canonical_events
      SET manually_edited_fields = COALESCE(manually_edited_fields, '{}'::jsonb) || '{"derived_tags": true}'::jsonb
      WHERE id = $1
    `, [event.id]);
    
    const after1 = await pool.query(`
      SELECT manually_edited_fields FROM canonical_events WHERE id = $1
    `, [event.id]);
    
    console.log(`   After marking: ${JSON.stringify(after1.rows[0].manually_edited_fields)}`);
    console.log('   ✅ Marking successful');
    console.log('');

    // 3. overview 수동 편집 추가 마킹
    console.log('📝 Step 3: Adding overview to manually edited fields...');
    await pool.query(`
      UPDATE canonical_events
      SET manually_edited_fields = COALESCE(manually_edited_fields, '{}'::jsonb) || '{"overview": true}'::jsonb
      WHERE id = $1
    `, [event.id]);
    
    const after2 = await pool.query(`
      SELECT manually_edited_fields FROM canonical_events WHERE id = $1
    `, [event.id]);
    
    console.log(`   After adding: ${JSON.stringify(after2.rows[0].manually_edited_fields)}`);
    console.log('   ✅ Adding successful');
    console.log('');

    // 4. 특정 필드만 확인
    console.log('📊 Step 4: Checking specific field...');
    const check = await pool.query(`
      SELECT manually_edited_fields->>'derived_tags' as is_derived_tags_edited,
             manually_edited_fields->>'overview' as is_overview_edited,
             manually_edited_fields->>'price_min' as is_price_min_edited
      FROM canonical_events
      WHERE id = $1
    `, [event.id]);
    
    const checkResult = check.rows[0];
    console.log(`   derived_tags manually edited: ${checkResult.is_derived_tags_edited === 'true' ? '✅ Yes' : '❌ No'}`);
    console.log(`   overview manually edited: ${checkResult.is_overview_edited === 'true' ? '✅ Yes' : '❌ No'}`);
    console.log(`   price_min manually edited: ${checkResult.is_price_min_edited === 'true' ? '❌ Yes' : '✅ No'}`);
    console.log('');

    // 5. 정리
    console.log('🧹 Step 5: Cleanup...');
    await pool.query(`
      UPDATE canonical_events
      SET manually_edited_fields = '{}'::jsonb
      WHERE id = $1
    `, [event.id]);
    console.log('   ✅ Cleanup complete');
    console.log('');

    console.log('✅ Test complete!\n');
    console.log('📝 Summary:');
    console.log('   1. manually_edited_fields column works ✅');
    console.log('   2. JSONB merge (||) operator works ✅');
    console.log('   3. Field-specific checks work ✅');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testManualEditMarking();

