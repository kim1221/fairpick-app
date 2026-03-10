/**
 * 팝업 카테고리 is_free=true 일괄 해제 스크립트
 *
 * 팝업 이벤트는 기본적으로 유료(입장료 없어도 브랜드 팝업이므로 "무료"로 표시 부적절)이므로
 * main_category='팝업'인 이벤트 중 is_free=true인 것을 모두 false로 변경한다.
 *
 * 수집 파이프라인이 재실행될 때 덮어써지지 않도록
 * manually_edited_fields->>'is_free' = true 도 함께 설정한다.
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function fixPopupIsFree() {
  console.log('[fix-popup-is-free] 시작...');

  try {
    // 1. 대상 건수 확인
    const countResult = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM canonical_events
      WHERE is_deleted = false
        AND main_category = '팝업'
        AND is_free = true
    `);
    const cnt = Number(countResult.rows[0].cnt);
    console.log(`[fix-popup-is-free] 대상: 팝업 & is_free=true → ${cnt}건`);

    if (cnt === 0) {
      console.log('[fix-popup-is-free] 수정할 데이터 없음. 종료.');
      return;
    }

    // 2. 미리보기 (처음 20개)
    const previewResult = await pool.query(`
      SELECT id, title, price_info, is_free
      FROM canonical_events
      WHERE is_deleted = false
        AND main_category = '팝업'
        AND is_free = true
      ORDER BY updated_at DESC
      LIMIT 20
    `);
    console.log('\n[fix-popup-is-free] 미리보기 (최대 20개):');
    for (const row of previewResult.rows) {
      console.log(`  - ${row.title.substring(0, 50)}  price_info="${row.price_info ?? '(없음)'}"`);
    }

    // 3. 일괄 업데이트
    //    manually_edited_fields->'is_free' = true 로 설정해 파이프라인 재수집 시 보호
    const updateResult = await pool.query(`
      UPDATE canonical_events
      SET
        is_free = false,
        manually_edited_fields = jsonb_set(
          COALESCE(manually_edited_fields, '{}'),
          '{is_free}',
          'true'
        ),
        updated_at = NOW()
      WHERE is_deleted = false
        AND main_category = '팝업'
        AND is_free = true
    `);

    console.log(`\n[fix-popup-is-free] ✅ ${updateResult.rowCount}건 업데이트 완료`);
    console.log('  - is_free: true → false');
    console.log('  - manually_edited_fields.is_free = true (재수집 시 보호)');

  } catch (error) {
    console.error('[fix-popup-is-free] 오류:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

fixPopupIsFree()
  .then(() => {
    console.log('[fix-popup-is-free] 종료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[fix-popup-is-free] 실패:', error);
    process.exit(1);
  });
