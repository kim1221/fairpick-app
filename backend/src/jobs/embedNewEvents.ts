/**
 * embedNewEvents.ts
 *
 * embedding IS NULL인 이벤트들의 벡터 임베딩을 생성하는 스케줄러 잡.
 * 매일 05:00 KST에 실행 — 데이터 수집/AI 보완 파이프라인 완료 후 동작.
 *
 * 수동 실행:
 *   npx ts-node -r dotenv/config src/scripts/backfill-embeddings.ts
 */

import { pool } from '../db';
import { buildEventText, embedDocument, toVectorLiteral } from '../lib/embeddingService';
import { EMBEDDING_MAX_DAYS_AHEAD } from '../config/collectionPolicy';

const BATCH_SIZE = 20;
const DELAY_MS = 300; // 배치 간 딜레이 (ms)

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function embedNewEvents(): Promise<number> {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[embedNewEvents] GEMINI_API_KEY not set — skipping');
    return 0;
  }

  // EMBEDDING_MAX_DAYS_AHEAD 이내 시작하는 이벤트만 임베딩 (비용 최적화)
  // 변경 전: 날짜 필터 없음 → 먼 미래 이벤트도 즉시 임베딩
  const embedFilter = `embedding IS NULL AND is_deleted = false
    AND (start_at IS NULL OR start_at <= NOW() + INTERVAL '${EMBEDDING_MAX_DAYS_AHEAD} days')`;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM canonical_events WHERE ${embedFilter}`
  );
  const total = parseInt(countRes.rows[0].count, 10);

  if (total === 0) {
    console.log('[embedNewEvents] No events to embed — done');
    return 0;
  }

  console.log(`[embedNewEvents] Found ${total} events without embeddings`);

  let processed = 0;
  let errors = 0;
  // total + 여유분으로 무한루프 방지 (에러로 인해 같은 이벤트가 반복 등장해도 안전하게 종료)
  const maxBatches = Math.ceil(total / BATCH_SIZE) + 10;
  let batchCount = 0;

  while (batchCount < maxBatches) {
    batchCount++;

    const batchRes = await pool.query<{
      id: string;
      title: string;
      display_title: string;
      venue: string;
      address: string;
      overview: string;
      main_category: string;
      sub_category: string;
      derived_tags: string[];
      region: string;
      price_info: string;
    }>(
      `SELECT id, title, display_title, venue, address, overview,
              main_category, sub_category, derived_tags, region, price_info
       FROM canonical_events
       WHERE ${embedFilter}
       ORDER BY created_at DESC
       LIMIT $1`,
      [BATCH_SIZE]
    );

    const batch = batchRes.rows;
    if (batch.length === 0) break;

    for (const row of batch) {
      try {
        const text = buildEventText({
          title: row.title,
          displayTitle: row.display_title,
          venue: row.venue,
          address: row.address,
          overview: row.overview,
          mainCategory: row.main_category,
          subCategory: row.sub_category,
          tags: row.derived_tags,
          region: row.region,
          priceInfo: row.price_info,
        });

        const embedding = await embedDocument(text);
        await pool.query(
          `UPDATE canonical_events SET embedding = $1::vector WHERE id = $2`,
          [toVectorLiteral(embedding), row.id]
        );
        processed++;
      } catch (err) {
        errors++;
        console.error(`[embedNewEvents] Error on event ${row.id}:`, (err as Error).message);
      }
    }

    await sleep(DELAY_MS);
  }

  console.log(`[embedNewEvents] Done — processed=${processed}, errors=${errors}`);
  return processed;
}
