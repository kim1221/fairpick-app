/**
 * is_free 필드 수정 스크립트
 *
 * 문제: price_min, price_max가 0보다 큰데 is_free=true인 경우
 * 해결: price_info를 기반으로 is_free를 재계산하여 업데이트
 */

import { Pool } from 'pg';
import { deriveIsFree } from '../utils/priceUtils';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixIsFreeField() {
  console.log('[Fix is_free] Starting...');

  try {
    // 1. 문제 데이터 조회: price_min 또는 price_max가 0보다 큰데 is_free=true인 경우
    const result = await pool.query(`
      SELECT id, title, price_min, price_max, price_info, is_free
      FROM canonical_events
      WHERE is_deleted = false
        AND is_free = true
        AND (price_min > 0 OR price_max > 0)
      ORDER BY updated_at DESC
    `);

    const problematicEvents = result.rows;
    console.log(`[Fix is_free] 문제 데이터 ${problematicEvents.length}개 발견`);

    if (problematicEvents.length === 0) {
      console.log('[Fix is_free] 수정할 데이터가 없습니다.');
      return;
    }

    // 2. 각 이벤트의 is_free 재계산 및 업데이트
    let fixedCount = 0;
    let skippedCount = 0;

    for (const event of problematicEvents) {
      // price_info 기반으로 is_free 재계산
      const computedIsFree = deriveIsFree(event.price_info);

      console.log(`[Fix is_free] Event: ${event.title.substring(0, 40)}...`);
      console.log(`  - price_min: ${event.price_min}, price_max: ${event.price_max}`);
      console.log(`  - price_info: "${event.price_info}"`);
      console.log(`  - 현재 is_free: ${event.is_free}`);
      console.log(`  - 계산된 is_free: ${computedIsFree}`);

      // price_info에 "무료"가 명시되어 있으면 유지, 아니면 false로 변경
      if (computedIsFree) {
        console.log(`  ⚠️  price_info에 "무료" 키워드가 있어서 is_free=true 유지`);
        skippedCount++;
      } else {
        // is_free를 false로 업데이트
        await pool.query(
          `UPDATE canonical_events
           SET is_free = false,
               updated_at = NOW()
           WHERE id = $1`,
          [event.id]
        );
        console.log(`  ✅ is_free를 false로 업데이트`);
        fixedCount++;
      }
      console.log('');
    }

    console.log('[Fix is_free] 완료!');
    console.log(`  - 수정된 이벤트: ${fixedCount}개`);
    console.log(`  - 스킵된 이벤트: ${skippedCount}개 (price_info에 "무료" 키워드 있음)`);
    console.log(`  - 총 처리: ${problematicEvents.length}개`);

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
