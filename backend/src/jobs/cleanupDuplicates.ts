/**
 * DB 중복 레코드 정리 스크립트
 * 
 * 지역 prefix/suffix 패턴 (`[부산] 행쇼` vs `행쇼 [부산]`)으로 인한 중복 제거
 * - 이미지가 있는 레코드 우선 유지
 * - sources 배열 병합
 */

import { pool } from '../db';

interface DuplicateGroup {
  content_key: string;
  display_title: string | null;
  start_at: Date;
  end_at: Date;
  region: string;
  main_category: string;
  ids: string[];
}

interface EventRecord {
  id: string;
  title: string;
  image_url: string | null;
  sources: unknown[];
}

/**
 * 중복 그룹 조회
 */
async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const result = await pool.query(`
    WITH normalized AS (
      SELECT
        id,
        content_key,
        display_title,
        start_at::date as start_at,
        end_at::date as end_at,
        region,
        main_category,
        image_url
      FROM canonical_events
      WHERE content_key IS NOT NULL
        AND content_key != ''
    )
    SELECT
      content_key,
      MAX(display_title) AS display_title,
      start_at,
      end_at,
      region,
      main_category,
      ARRAY_AGG(id::text ORDER BY
        CASE WHEN image_url IS NOT NULL AND image_url NOT LIKE '%placeholder%' AND image_url != ''
             THEN 0 ELSE 1 END,
        id
      ) as ids
    FROM normalized
    GROUP BY content_key, start_at, end_at, region, main_category
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC;
  `);

  return result.rows.map(row => ({
    content_key: row.content_key,
    display_title: row.display_title,
    start_at: row.start_at,
    end_at: row.end_at,
    region: row.region,
    main_category: row.main_category,
    ids: row.ids,
  }));
}

/**
 * 레코드 조회
 */
async function getEventRecords(ids: string[]): Promise<EventRecord[]> {
  const result = await pool.query(`
    SELECT id, title, image_url, sources
    FROM canonical_events
    WHERE id = ANY($1)
  `, [ids]);

  return result.rows.map(row => ({
    id: row.id,
    title: row.title,
    image_url: row.image_url,
    sources: typeof row.sources === 'string' ? JSON.parse(row.sources) : row.sources || [],
  }));
}

/**
 * 이미지 우선순위 점수
 */
function getImageScore(imageUrl: string | null): number {
  if (!imageUrl) return 0;
  if (imageUrl.toLowerCase().includes('placeholder')) return 1;
  if (imageUrl === '') return 0;
  return 100 + Math.min(imageUrl.length, 100);
}

/**
 * 중복 그룹에서 유지할 레코드 선택
 */
function selectMasterRecord(records: EventRecord[]): EventRecord {
  return records.sort((a, b) => {
    // 1. 이미지 우선
    const imgScoreA = getImageScore(a.image_url);
    const imgScoreB = getImageScore(b.image_url);
    if (imgScoreB !== imgScoreA) return imgScoreB - imgScoreA;

    // 2. sources 배열이 더 큰 쪽
    const sourcesA = Array.isArray(a.sources) ? a.sources.length : 0;
    const sourcesB = Array.isArray(b.sources) ? b.sources.length : 0;
    if (sourcesB !== sourcesA) return sourcesB - sourcesA;

    // 3. 제목 길이 (짧은 쪽 - 더 정규화된 제목)
    return a.title.length - b.title.length;
  })[0];
}

/**
 * sources 배열 병합 (중복 제거)
 */
function mergeSources(records: EventRecord[]): unknown[] {
  const seen = new Set<string>();
  const merged: unknown[] = [];

  for (const record of records) {
    if (!Array.isArray(record.sources)) continue;
    for (const src of record.sources) {
      const srcObj = src as { source?: string; sourceEventId?: string };
      const key = `${srcObj.source || ''}||${srcObj.sourceEventId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(src);
      }
    }
  }

  return merged;
}

/**
 * 레코드 업데이트 (sources 병합, 이미지 보강)
 */
async function updateMasterRecord(
  masterId: string,
  mergedSources: unknown[],
  bestImageUrl: string | null
): Promise<void> {
  const updates: string[] = ['sources = $1', 'updated_at = NOW()'];
  const params: unknown[] = [JSON.stringify(mergedSources)];

  if (bestImageUrl) {
    updates.push(`image_url = $${params.length + 1}`);
    params.push(bestImageUrl);
  }

  params.push(masterId);

  await pool.query(
    `UPDATE canonical_events SET ${updates.join(', ')} WHERE id = $${params.length}`,
    params
  );
}

/**
 * 레코드 삭제
 */
async function deleteRecords(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(`DELETE FROM canonical_events WHERE id = ANY($1)`, [ids]);
}

/**
 * 메인 정리 함수
 */
export async function cleanupDuplicates(dryRun = true): Promise<{
  groupsProcessed: number;
  recordsDeleted: number;
  recordsUpdated: number;
}> {
  console.log(`[CleanupDuplicates] Starting... (dryRun=${dryRun})`);

  const groups = await findDuplicateGroups();
  console.log(`[CleanupDuplicates] Found ${groups.length} duplicate groups`);

  let groupsProcessed = 0;
  let recordsDeleted = 0;
  let recordsUpdated = 0;

  for (const group of groups) {
    const records = await getEventRecords(group.ids);
    if (records.length < 2) continue;

    const master = selectMasterRecord(records);
    if (!master) {
      console.warn(`[CleanupDuplicates] No master found for group, skipping`);
      continue;
    }
    const others = records.filter(r => r.id !== master.id);
    const mergedSources = mergeSources(records);

    // 이미지 보강: master에 이미지가 없으면 다른 레코드에서 가져옴
    let bestImageUrl = master.image_url;
    if (!bestImageUrl || bestImageUrl.includes('placeholder') || bestImageUrl === '') {
      for (const other of others) {
        if (other.image_url && !other.image_url.includes('placeholder') && other.image_url !== '') {
          bestImageUrl = other.image_url;
          break;
        }
      }
    }

    const displayTitle = group.display_title || '(no display_title)';
    console.log(`[CleanupDuplicates] Group: "${displayTitle.substring(0, 30)}"`);
    console.log(`  Keep: ${master.id.substring(0, 8)} (${master.title.substring(0, 25)})`);
    console.log(`  Delete: ${others.map(o => o.id.substring(0, 8)).join(', ')}`);
    console.log(`  Image: ${bestImageUrl ? 'YES' : 'NO'}`);

    if (!dryRun) {
      // 실제 업데이트 및 삭제
      await updateMasterRecord(master.id, mergedSources, bestImageUrl);
      await deleteRecords(others.map(o => o.id));
      recordsUpdated++;
      recordsDeleted += others.length;
    }

    groupsProcessed++;
  }

  console.log(`[CleanupDuplicates] Complete!`);
  console.log(`  Groups processed: ${groupsProcessed}`);
  console.log(`  Records updated: ${recordsUpdated}`);
  console.log(`  Records deleted: ${recordsDeleted}`);

  return { groupsProcessed, recordsDeleted, recordsUpdated };
}

// CLI 실행
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--execute');
  
  if (dryRun) {
    console.log('[CleanupDuplicates] Running in DRY RUN mode. Use --execute to actually delete records.');
  }

  cleanupDuplicates(dryRun)
    .then((result) => {
      console.log('[CleanupDuplicates] Result:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[CleanupDuplicates] Error:', err);
      process.exit(1);
    });
}
