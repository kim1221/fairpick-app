/**
 * venue 이름 중복 패턴 수정 스크립트
 *
 * KOPIS 등 수집 데이터에서 간혹 venue 이름이 아래처럼 중복 저장됨:
 *   "소명아트홀 (구.메가폴리스아트홀) (소명아트홀 (구.메가폴리스아트홀))"
 *
 * 패턴: "A (A)" — 동일한 venue 이름이 괄호로 한 번 더 반복됨
 * 수정: 앞쪽 A만 남기고 뒤쪽 "(A)" 제거
 *
 * 실행:
 *   DATABASE_URL=... npx ts-node --transpile-only -r dotenv/config src/scripts/fix-venue-duplicate.ts
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * "A (A)" 패턴 감지 및 정제
 * 예: "소명아트홀 (구.메가폴리스아트홀) (소명아트홀 (구.메가폴리스아트홀))" → "소명아트홀 (구.메가폴리스아트홀)"
 */
function cleanVenueName(venue: string): string | null {
  const match = venue.match(/^(.+) \(\1\)$/);
  if (match) return match[1];
  return null; // 변경 불필요
}

async function fixVenueDuplicate() {
  console.log('[fix-venue-duplicate] 시작...');

  try {
    // 1. 전체 venue 조회 (삭제되지 않은 이벤트, venue 있는 것)
    const rows = await pool.query<{ id: string; title: string; venue: string }>(`
      SELECT id, title, venue
      FROM canonical_events
      WHERE is_deleted = false
        AND venue IS NOT NULL
        AND venue != ''
      ORDER BY updated_at DESC
    `);

    console.log(`[fix-venue-duplicate] 전체 조회: ${rows.rowCount}건`);

    const toUpdate: Array<{ id: string; oldVenue: string; newVenue: string; title: string }> = [];

    for (const row of rows.rows) {
      const cleaned = cleanVenueName(row.venue);
      if (cleaned) {
        toUpdate.push({ id: row.id, oldVenue: row.venue, newVenue: cleaned, title: row.title });
      }
    }

    console.log(`[fix-venue-duplicate] 수정 대상: ${toUpdate.length}건`);

    if (toUpdate.length === 0) {
      console.log('[fix-venue-duplicate] 수정할 데이터 없음. 종료.');
      return;
    }

    // 2. 미리보기
    console.log('\n[fix-venue-duplicate] 수정 대상 목록:');
    for (const item of toUpdate) {
      console.log(`  - "${item.title.substring(0, 40)}"`);
      console.log(`    전: ${item.oldVenue}`);
      console.log(`    후: ${item.newVenue}`);
    }

    // 3. 일괄 업데이트
    let updatedCount = 0;
    for (const item of toUpdate) {
      await pool.query(`
        UPDATE canonical_events
        SET venue = $1, updated_at = NOW()
        WHERE id = $2
      `, [item.newVenue, item.id]);
      updatedCount++;
    }

    console.log(`\n[fix-venue-duplicate] ✅ ${updatedCount}건 수정 완료`);

  } catch (error) {
    console.error('[fix-venue-duplicate] 오류:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

fixVenueDuplicate()
  .then(() => {
    console.log('[fix-venue-duplicate] 종료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[fix-venue-duplicate] 실패:', error);
    process.exit(1);
  });
