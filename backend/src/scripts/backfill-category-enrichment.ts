/**
 * Category Enrichment Backfill
 *
 * 공연/전시/축제 이벤트 중 개요(overview) 또는 AI태그(derived_tags)가 없는 이벤트에
 * 네이버 검색 + Gemini AI로 정보를 채워 넣는 스크립트.
 *
 * 실행:
 *   npx ts-node -r dotenv/config src/scripts/backfill-category-enrichment.ts
 *   npx ts-node -r dotenv/config src/scripts/backfill-category-enrichment.ts --limit=50
 *   npx ts-node -r dotenv/config src/scripts/backfill-category-enrichment.ts --category=공연
 *   npx ts-node -r dotenv/config src/scripts/backfill-category-enrichment.ts --tags-only
 */

import { pool } from '../db';
import { searchEventInfoEnhanced } from '../lib/naverApi';
import { extractEventInfoEnhanced, extractDerivedTagsOnly } from '../lib/aiExtractor';
import {
  filterSearchResults,
  scoreSearchResults,
  capResultsByDomain,
  groupResultsBySection,
  ScoredSearchResult,
} from '../lib/searchScoring';

interface TargetEvent {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  venue: string | null;
  address: string | null;
  overview: string | null;
  derived_tags: any[] | null;
  start_at: Date | null;
  end_at: Date | null;
}

const DELAY_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatResultForAI(r: ScoredSearchResult, idx: number): string {
  let text = `[${idx}] (${r.source}) title="${r.title}"`;
  if (r.description) text += ` snippet="${r.description.slice(0, 200).replace(/\n/g, ' ')}"`;
  if (r.link) text += ` url="${r.link}"`;
  if (r.address) text += ` address="${r.address}"`;
  return text;
}

async function enrichEvent(
  event: TargetEvent,
  tagsOnly: boolean,
  stats: Record<string, number>
): Promise<void> {
  const needsOverview = !event.overview || event.overview.trim() === '';
  const needsTags = !event.derived_tags || event.derived_tags.length === 0;

  if (!needsOverview && !needsTags) {
    stats.skipped++;
    return;
  }

  console.log(`\n[Backfill] ${event.title}`);
  console.log(`  overview: ${needsOverview ? '없음' : '있음'}, tags: ${needsTags ? '없음' : '있음'}`);

  try {
    const startYear = event.start_at ? new Date(event.start_at).getFullYear() : new Date().getFullYear();
    const endYear = event.end_at ? new Date(event.end_at).getFullYear() : startYear;

    let overviewResult: string | null = null;
    let tagsResult: string[] | null = null;

    if (tagsOnly || (!needsOverview && needsTags)) {
      // 태그만 필요한 경우: extractDerivedTagsOnly 사용 (빠르고 저렴)
      const tags = await extractDerivedTagsOnly(
        event.title,
        event.main_category,
        event.sub_category,
        event.overview
      );
      tagsResult = tags.length > 0 ? tags : null;
    } else {
      // 개요 또는 개요+태그가 필요한 경우: 전체 파이프라인
      const allResults = await searchEventInfoEnhanced(
        event.title,
        event.venue || '',
        startYear,
        endYear,
        event.main_category
      ).catch((e) => {
        console.warn('[Backfill] 네이버 검색 실패:', e.message);
        return [];
      });

      let aiContext: { ticket: string[]; official: string[]; place: string[]; blog: string[] };

      if (allResults.length > 0) {
        const filtered = filterSearchResults(allResults, [startYear, endYear]);
        const scored = scoreSearchResults(filtered, {
          title: event.title,
          venue: event.venue || '',
          startYear,
          endYear,
          startMonth: event.start_at ? new Date(event.start_at).getMonth() + 1 : 1,
        });
        const capped = capResultsByDomain(scored, { maxPerDomain: 2, maxWeb: 15, maxBlog: 6, maxPlace: 3 });
        const sections = groupResultsBySection(capped);

        let globalIdx = 0;
        aiContext = {
          ticket: sections.ticket.map((r) => formatResultForAI(r, globalIdx++)),
          official: sections.official.map((r) => formatResultForAI(r, globalIdx++)),
          place: sections.place.map((r) => formatResultForAI(r, globalIdx++)),
          blog: sections.blog.map((r) => formatResultForAI(r, globalIdx++)),
        };
      } else {
        // 검색 결과 없음 → 빈 섹션으로 구글 그라운딩 사용
        aiContext = { ticket: [], official: [], place: [], blog: [] };
      }

      const yearTokens = startYear === endYear ? `${startYear}` : `${startYear} ${endYear}`;
      const extracted = await extractEventInfoEnhanced(
        event.title,
        event.main_category,
        event.overview,
        yearTokens,
        aiContext,
        event.address || undefined,
        event.venue || undefined
      );

      if (extracted) {
        overviewResult = extracted.overview || null;
        tagsResult = extracted.derived_tags && extracted.derived_tags.length > 0
          ? extracted.derived_tags
          : null;
      }

      // overview가 AI에서 안 나오고 태그만 필요하면 태그만 추출
      if (!tagsResult && needsTags) {
        const tags = await extractDerivedTagsOnly(
          event.title,
          event.main_category,
          event.sub_category,
          event.overview
        );
        tagsResult = tags.length > 0 ? tags : null;
      }
    }

    // DB 업데이트
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (needsOverview && overviewResult) {
      updateFields.push(`overview = $${paramIndex++}`);
      updateValues.push(overviewResult);
      stats.overview_updated = (stats.overview_updated || 0) + 1;
      console.log('[Backfill] ✅ overview 업데이트');
    }

    if (needsTags && tagsResult) {
      updateFields.push(`derived_tags = $${paramIndex++}`);
      updateValues.push(JSON.stringify(tagsResult));
      stats.tags_updated = (stats.tags_updated || 0) + 1;
      console.log('[Backfill] ✅ derived_tags 업데이트:', tagsResult.length, '개');
    }

    if (updateFields.length > 0) {
      updateValues.push(event.id);
      await pool.query(
        `UPDATE canonical_events SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        updateValues
      );
      stats.success++;
    } else {
      stats.skipped++;
      console.log('[Backfill] ⚠️ AI가 유효한 데이터를 반환하지 않음');
    }
  } catch (err: any) {
    console.error('[Backfill] ❌ Error:', err.message);
    stats.failed++;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let categoryFilter: string | null = null;
  let tagsOnly = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) limit = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--category=')) categoryFilter = arg.split('=')[1];
    if (arg === '--tags-only') tagsOnly = true;
  }

  const categories = categoryFilter ? [categoryFilter] : ['공연', '전시', '축제'];

  console.log('\n========================================');
  console.log('🤖 Category Enrichment Backfill');
  console.log(`  대상: ${categories.join(' / ')}`);
  console.log(`  모드: ${tagsOnly ? 'AI 태그만' : '개요 + AI 태그'}`);
  console.log(`  limit: ${limit ?? '전체'}`);
  console.log('========================================\n');

  let sql = `
    SELECT id, title, main_category, sub_category, venue, address, overview,
           derived_tags, start_at, end_at
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND main_category = ANY($1)
      AND (
        overview IS NULL OR overview = ''
        OR derived_tags IS NULL OR jsonb_array_length(derived_tags::jsonb) = 0
      )
    ORDER BY
      CASE main_category WHEN '공연' THEN 1 WHEN '전시' THEN 2 ELSE 3 END,
      created_at DESC
  `;

  if (limit) sql += ` LIMIT ${limit}`;

  const result = await pool.query<TargetEvent>(sql, [categories]);
  const events = result.rows;

  console.log(`📊 처리 대상: ${events.length}개 이벤트`);
  if (events.length === 0) {
    console.log('✅ 처리할 이벤트 없음');
    await pool.end();
    return;
  }

  const stats: Record<string, number> = {
    total: events.length,
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    overview_updated: 0,
    tags_updated: 0,
  };

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    console.log(`\n===== [${i + 1}/${events.length}] =====`);
    await enrichEvent(event, tagsOnly, stats);
    stats.processed++;

    // 진행률 출력 (50개마다)
    if ((i + 1) % 50 === 0) {
      console.log(`\n📊 중간 리포트 (${i + 1}/${events.length}):`);
      console.log(`  성공: ${stats.success}, 실패: ${stats.failed}, 스킵: ${stats.skipped}`);
      console.log(`  overview: ${stats.overview_updated}, 태그: ${stats.tags_updated}`);
    }

    if (i < events.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n========================================');
  console.log('📊 최종 리포트');
  console.log('========================================');
  console.log(`총: ${stats.total}개`);
  console.log(`성공: ${stats.success}개`);
  console.log(`실패: ${stats.failed}개`);
  console.log(`스킵: ${stats.skipped}개`);
  console.log(`overview 업데이트: ${stats.overview_updated}개`);
  console.log(`태그 업데이트: ${stats.tags_updated}개`);
  console.log('========================================\n');

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
