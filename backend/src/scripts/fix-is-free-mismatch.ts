/**
 * is_free 필드 수정 스크립트
 *
 * 문제: price_min/max가 0보다 크거나 price_info가 있는데 is_free=true인 경우
 * 해결: price_info를 기반으로 is_free를 재계산하여 업데이트
 *
 * 수정 후 manually_edited_fields.is_free = true 를 설정해
 * 스케줄러가 다시 덮어쓰지 않도록 보호한다.
 */

import { Pool } from 'pg';
import { deriveIsFree } from '../utils/priceUtils';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function fixIsFreeField() {
  console.log('[Fix is_free] Starting...');

  try {
    // 1. 수정 대상 조회
    //    - is_free = true 이면서 price_min/max > 0 인 케이스 (명백한 불일치)
    //    - 또는 price_info가 있는데 is_free = true 인 케이스
    //    - manually_edited_fields.is_free 가 설정된 것은 건드리지 않음
    const result = await pool.query(`
      SELECT id, title, main_category, price_min, price_max, price_info, is_free,
             manually_edited_fields
      FROM canonical_events
      WHERE is_deleted = false
        AND is_free = true
        AND (
          price_min > 0
          OR price_max > 0
          OR (price_info IS NOT NULL AND price_info != '')
        )
        AND (manually_edited_fields->>'is_free') IS NULL
      ORDER BY main_category, updated_at DESC
    `);

    const events = result.rows;
    console.log(`[Fix is_free] 수정 후보: ${events.length}개`);

    if (events.length === 0) {
      console.log('[Fix is_free] 수정할 데이터가 없습니다.');
      return;
    }

    // 카테고리별 요약
    const byCat: Record<string, number> = {};
    for (const e of events) {
      byCat[e.main_category] = (byCat[e.main_category] ?? 0) + 1;
    }
    console.log('[Fix is_free] 카테고리별:', byCat);
    console.log('');

    // 2. 각 이벤트의 is_free 재계산 및 업데이트
    let fixedCount = 0;
    let skippedCount = 0;

    for (const event of events) {
      // price_info 기반으로 is_free 재계산
      const computedIsFree = deriveIsFree(event.price_info);

      // price_info에 "무료" 키워드가 명시되어 있으면 is_free=true 유지
      if (computedIsFree) {
        // price_min > 0 이면서 price_info도 "무료"라고 되어 있는 경우 → 데이터 자체가 모순
        // price_min > 0 인 경우에는 무조건 false로
        if (event.price_min > 0 || event.price_max > 0) {
          console.log(`[Fix is_free] ⚠️  price_min=${event.price_min} 이지만 price_info에 "무료" 키워드도 있음 → false로 수정`);
          console.log(`  title: ${String(event.title).substring(0, 50)}`);
          console.log(`  price_info: "${event.price_info}"`);
        } else {
          // price_min은 null/0인데 price_info에 "무료"가 있음 → is_free=true가 맞음
          skippedCount++;
          continue;
        }
      }

      // is_free를 false로 업데이트 + manually_edited_fields.is_free 보호 플래그 설정
      await pool.query(
        `UPDATE canonical_events
         SET is_free = false,
             manually_edited_fields = jsonb_set(
               COALESCE(manually_edited_fields, '{}'),
               '{is_free}',
               'true'
             ),
             updated_at = NOW()
         WHERE id = $1`,
        [event.id]
      );

      console.log(`✅ [${event.main_category}] ${String(event.title).substring(0, 45)} → is_free=false`);
      console.log(`   price_min=${event.price_min ?? 'null'} price_max=${event.price_max ?? 'null'} price_info="${event.price_info ?? '(없음)'}"`);
      fixedCount++;
    }

    console.log('');
    console.log('[Fix is_free] 완료!');
    console.log(`  - 수정: ${fixedCount}개`);
    console.log(`  - 스킵 (price_info에 "무료" 키워드 있음): ${skippedCount}개`);
    console.log(`  - 총 처리: ${events.length}개`);
    console.log('  ※ 수정된 항목은 manually_edited_fields.is_free = true 로 보호됨');

  } catch (error) {
    console.error('[Fix is_free] 오류 발생:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// 실행
fixIsFreeField()
  .then(() => {
    console.log('[Fix is_free] 스크립트 종료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Fix is_free] 스크립트 실패:', error);
    process.exit(1);
  });
