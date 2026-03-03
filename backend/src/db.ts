import { Pool } from 'pg';
import { config } from './config';

// DATABASE_URL이 있으면 connectionString으로, 없으면 개별 환경변수로 연결
export const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool(config.db);

export async function upsertEvent(event: EventRecord) {
  await pool.query(
    `
      INSERT INTO events (
        id, source, external_id, title, description, overview, venue, period_text,
        start_date, end_date, region, category, tags,
        thumbnail_url, detail_image_url, detail_link, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17
      )
      ON CONFLICT (source, external_id)
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        overview = EXCLUDED.overview,
        venue = EXCLUDED.venue,
        period_text = EXCLUDED.period_text,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        region = EXCLUDED.region,
        category = EXCLUDED.category,
        tags = EXCLUDED.tags,
        thumbnail_url = EXCLUDED.thumbnail_url,
        detail_image_url = EXCLUDED.detail_image_url,
        detail_link = EXCLUDED.detail_link,
        updated_at = EXCLUDED.updated_at
    `,
    [
      event.id,
      event.source,
      event.externalId,
      event.title,
      event.description,
      event.overview,
      event.venue,
      event.periodText,
      event.startDate,
      event.endDate,
      event.region,
      event.category,
      JSON.stringify(event.tags ?? []),
      event.thumbnailUrl,
      event.detailImageUrl,
      event.detailLink,
      event.updatedAt,
    ],
  );
}

export interface EventRecord {
  id: string;
  source: string;
  externalId: string;
  title: string;
  description: string;
  overview: string;
  venue: string;
  periodText: string;
  startDate: string;
  endDate: string;
  region: string;
  category: string;
  tags?: string[];
  thumbnailUrl: string;
  detailImageUrl: string;
  detailLink: string;
  updatedAt: string;
}

// Raw 테이블 공통 인터페이스
export interface RawEventRecord {
  sourceEventId: string;
  sourceUrl?: string;
  payload: Record<string, unknown>;
  title?: string;
  startAt?: string;
  endAt?: string;
  venue?: string;
  region?: string;
  mainCategory?: string;
  subCategory?: string;
  imageUrl?: string;
  isFree?: boolean;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface RawKopisEvent extends RawEventRecord {}
export interface RawCultureEvent extends RawEventRecord {}
export interface RawTourEvent extends RawEventRecord {}

// Raw 테이블 UPSERT 함수들
export async function upsertRawKopisEvent(event: RawKopisEvent) {
  await pool.query(
    `
      INSERT INTO raw_kopis_events (
        source, source_event_id, source_url, payload,
        title, start_at, end_at, venue, region,
        main_category, sub_category, image_url, is_free,
        address, lat, lng, updated_at
      )
      VALUES (
        'kopis', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
      )
      ON CONFLICT (source, source_event_id)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        payload = EXCLUDED.payload,
        title = EXCLUDED.title,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        venue = EXCLUDED.venue,
        region = EXCLUDED.region,
        main_category = EXCLUDED.main_category,
        sub_category = EXCLUDED.sub_category,
        image_url = EXCLUDED.image_url,
        is_free = EXCLUDED.is_free,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = NOW()
    `,
    [
      event.sourceEventId,
      event.sourceUrl,
      JSON.stringify(event.payload),
      event.title,
      event.startAt,
      event.endAt,
      event.venue,
      event.region,
      event.mainCategory,
      event.subCategory,
      event.imageUrl,
      event.isFree ?? false,
      event.address,
      event.lat,
      event.lng,
    ],
  );
}

export async function upsertRawCultureEvent(event: RawCultureEvent) {
  await pool.query(
    `
      INSERT INTO raw_culture_events (
        source, source_event_id, source_url, payload,
        title, start_at, end_at, venue, region,
        main_category, sub_category, image_url, is_free,
        address, lat, lng, updated_at
      )
      VALUES (
        'culture', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
      )
      ON CONFLICT (source, source_event_id)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        payload = EXCLUDED.payload,
        title = EXCLUDED.title,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        venue = EXCLUDED.venue,
        region = EXCLUDED.region,
        main_category = EXCLUDED.main_category,
        sub_category = EXCLUDED.sub_category,
        image_url = EXCLUDED.image_url,
        is_free = EXCLUDED.is_free,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = NOW()
    `,
    [
      event.sourceEventId,
      event.sourceUrl,
      JSON.stringify(event.payload),
      event.title,
      event.startAt,
      event.endAt,
      event.venue,
      event.region,
      event.mainCategory,
      event.subCategory,
      event.imageUrl,
      event.isFree ?? false,
      event.address,
      event.lat,
      event.lng,
    ],
  );
}

export async function upsertRawTourEvent(event: RawTourEvent) {
  await pool.query(
    `
      INSERT INTO raw_tour_events (
        source, source_event_id, source_url, payload,
        title, start_at, end_at, venue, region,
        main_category, sub_category, image_url,
        address, lat, lng, updated_at
      )
      VALUES (
        'tour', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
      )
      ON CONFLICT (source, source_event_id)
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        payload = EXCLUDED.payload,
        title = EXCLUDED.title,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        venue = EXCLUDED.venue,
        region = EXCLUDED.region,
        main_category = EXCLUDED.main_category,
        sub_category = EXCLUDED.sub_category,
        image_url = EXCLUDED.image_url,
        address = EXCLUDED.address,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = NOW()
    `,
    [
      event.sourceEventId,
      event.sourceUrl,
      JSON.stringify(event.payload),
      event.title,
      event.startAt,
      event.endAt,
      event.venue,
      event.region,
      event.mainCategory,
      event.subCategory,
      event.imageUrl,
      event.address,
      event.lat,
      event.lng,
    ],
  );
}

// Raw 이벤트 조회용 인터페이스
export interface RawEventFromDB {
  id: string;
  source: string;
  source_event_id: string;
  source_url: string | null;
  title: string | null;
  start_at: string | null;
  end_at: string | null;
  venue: string | null;
  region: string | null;
  main_category: string | null;
  sub_category: string | null;
  image_url: string | null;
  is_free: boolean | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  payload?: Record<string, unknown>; // Phase 1: 상세 정보 추출용
}

// Canonical 이벤트 인터페이스
export interface CanonicalEvent {
  canonicalKey: string;
  title: string;
  displayTitle?: string;
  contentKey?: string;
  startAt: string | null;
  endAt: string | null;
  venue: string | null;
  region: string | null;
  mainCategory: string | null;
  subCategory: string | null;
  imageUrl: string | null;
  isFree?: boolean;
  address?: string;
  lat?: number;
  lng?: number;
  sourcePriorityWinner: string;
  sources: Array<{
    source: string;
    rawTable: string;
    rawId: string;
    sourceEventId: string;
    sourceUrl: string | null;
    imageUrl: string | null;
    title: string | null;
    startAt: string | null;
    endAt: string | null;
  }>;
  // Phase 1 공통 필드
  externalLinks?: Record<string, string | null>;
  status?: string;
  priceMin?: number | null;
  priceMax?: number | null;
  sourceTags?: string[];
  derivedTags?: string[];
  qualityFlags?: Record<string, boolean>;
  fieldSources?: Record<string, any>; // 🆕 필드별 데이터 출처
}

// Raw 테이블에서 모든 이벤트 조회
export async function getAllRawKopisEvents(): Promise<RawEventFromDB[]> {
  const result = await pool.query(`
    SELECT
      id, source, source_event_id, source_url,
      title, start_at, end_at, venue, region,
      main_category, sub_category, image_url, is_free,
      address, lat, lng, payload
    FROM raw_kopis_events
    ORDER BY start_at DESC, updated_at DESC
  `);
  return result.rows;
}

export async function getAllRawCultureEvents(): Promise<RawEventFromDB[]> {
  const result = await pool.query(`
    SELECT
      id, source, source_event_id, source_url,
      title, start_at, end_at, venue, region,
      main_category, sub_category, image_url, is_free,
      address, lat, lng, payload
    FROM raw_culture_events
    ORDER BY start_at DESC, updated_at DESC
  `);
  return result.rows;
}

export async function getAllRawTourEvents(): Promise<RawEventFromDB[]> {
  const result = await pool.query(`
    SELECT
      id, source, source_event_id, source_url,
      title, start_at, end_at, venue, region,
      main_category, sub_category, image_url, is_free,
      address, lat, lng, payload
    FROM raw_tour_events
    ORDER BY start_at DESC, updated_at DESC
  `);
  return result.rows;
}

// Canonical 이벤트 UPSERT
export async function upsertCanonicalEvent(event: CanonicalEvent) {
  // UPSERT 전 존재 여부 확인 (로그용)
  const existingResult = await pool.query(
    `SELECT image_url FROM canonical_events WHERE canonical_key = $1 LIMIT 1`,
    [event.canonicalKey],
  );
  const existed = existingResult.rows.length > 0;
  const existingImageUrl = existed ? existingResult.rows[0].image_url : null;

  await pool.query(
    `
      INSERT INTO canonical_events (
        canonical_key, title, display_title, content_key, start_at, end_at, venue, region,
        main_category, sub_category, image_url, is_free,
        address, lat, lng,
        source_priority_winner, sources,
        external_links, status, price_min, price_max, source_tags, derived_tags, quality_flags,
        field_sources,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18::jsonb, $19, $20, $21, $22::jsonb, $23::jsonb, $24::jsonb,
        $25::jsonb,
        NOW()
      )
      ON CONFLICT (canonical_key)
      DO UPDATE SET
        title = CASE
          WHEN (canonical_events.manually_edited_fields->>'title')::boolean = true
          THEN canonical_events.title
          ELSE EXCLUDED.title
        END,
        display_title = CASE
          WHEN (canonical_events.manually_edited_fields->>'display_title')::boolean = true
          THEN canonical_events.display_title
          ELSE EXCLUDED.display_title
        END,
        content_key = EXCLUDED.content_key,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        venue = CASE
          WHEN (canonical_events.manually_edited_fields->>'venue')::boolean = true
          THEN canonical_events.venue
          ELSE EXCLUDED.venue
        END,
        region = CASE
          WHEN (canonical_events.manually_edited_fields->>'region')::boolean = true
          THEN canonical_events.region
          ELSE EXCLUDED.region
        END,
        main_category = CASE
          WHEN (canonical_events.manually_edited_fields->>'main_category')::boolean = true
          THEN canonical_events.main_category
          ELSE EXCLUDED.main_category
        END,
        sub_category = CASE
          WHEN (canonical_events.manually_edited_fields->>'sub_category')::boolean = true
          THEN canonical_events.sub_category
          ELSE EXCLUDED.sub_category
        END,
        image_url = CASE
          WHEN canonical_events.image_url IS NOT NULL
            AND canonical_events.image_url != ''
            AND canonical_events.image_url NOT LIKE '%placeholder%'
          THEN canonical_events.image_url
          ELSE EXCLUDED.image_url
        END,
        is_free = CASE
          WHEN (canonical_events.manually_edited_fields->>'is_free')::boolean = true
          THEN canonical_events.is_free
          ELSE EXCLUDED.is_free
        END,
        address = CASE
          WHEN (canonical_events.manually_edited_fields->>'address')::boolean = true
          THEN canonical_events.address
          ELSE EXCLUDED.address
        END,
        lat = CASE
          WHEN (canonical_events.manually_edited_fields->>'lat')::boolean = true
          THEN canonical_events.lat
          ELSE EXCLUDED.lat
        END,
        lng = CASE
          WHEN (canonical_events.manually_edited_fields->>'lng')::boolean = true
          THEN canonical_events.lng
          ELSE EXCLUDED.lng
        END,
        source_priority_winner = EXCLUDED.source_priority_winner,
        sources = EXCLUDED.sources,
        external_links = COALESCE(EXCLUDED.external_links, canonical_events.external_links),
        status = EXCLUDED.status,
        price_min = CASE
          WHEN (canonical_events.manually_edited_fields->>'price_min')::boolean = true
          THEN canonical_events.price_min
          ELSE COALESCE(EXCLUDED.price_min, canonical_events.price_min)
        END,
        price_max = CASE
          WHEN (canonical_events.manually_edited_fields->>'price_max')::boolean = true
          THEN canonical_events.price_max
          ELSE COALESCE(EXCLUDED.price_max, canonical_events.price_max)
        END,
        source_tags = COALESCE(EXCLUDED.source_tags, canonical_events.source_tags),
        derived_tags = CASE
          WHEN EXCLUDED.derived_tags IS NOT NULL AND jsonb_array_length(EXCLUDED.derived_tags) > 0
          THEN EXCLUDED.derived_tags
          ELSE canonical_events.derived_tags
        END,
        quality_flags = EXCLUDED.quality_flags,
        field_sources = COALESCE(EXCLUDED.field_sources, canonical_events.field_sources, '{}'::jsonb),
        updated_at = NOW()
    `,
    [
      event.canonicalKey,
      event.title,
      event.displayTitle ?? event.title,
      event.contentKey ?? null,
      event.startAt,
      event.endAt,
      event.venue,
      event.region,
      event.mainCategory,
      event.subCategory,
      event.imageUrl,
      event.isFree ?? false,
      event.address ?? null,
      event.lat ?? null,
      event.lng ?? null,
      event.sourcePriorityWinner,
      JSON.stringify(event.sources),
      JSON.stringify(event.externalLinks || {}),
      event.status || 'unknown',
      event.priceMin ?? null,
      event.priceMax ?? null,
      JSON.stringify(event.sourceTags || []),
      event.derivedTags && event.derivedTags.length > 0 ? JSON.stringify(event.derivedTags) : null,
      JSON.stringify(event.qualityFlags || {}),
      JSON.stringify(event.fieldSources || {}), // 🆕
    ],
  );

  // 로그 출력
  const action = existed ? 'UPDATE' : 'INSERT';
  const hasRealExistingImage = existingImageUrl && existingImageUrl !== '' && !existingImageUrl.includes('placeholder');
  const hasRealNewImage = event.imageUrl && event.imageUrl !== '' && !event.imageUrl.includes('placeholder');

  let imageStrategy: string;
  if (existed && hasRealExistingImage) {
    imageStrategy = 'kept_existing';
  } else if (hasRealNewImage) {
    imageStrategy = 'replaced_placeholder';
  } else {
    imageStrategy = 'no_change';
  }

  console.log(`[Ingest][Upsert] { canonicalKey: "${event.canonicalKey}", action: "${action}", imageStrategy: "${imageStrategy}" }`);
}

// 이미지가 없는 Canonical 이벤트 조회
export interface CanonicalEventWithoutImage {
  id: string;
  title: string;
  source_priority_winner: string;
  sources: string; // JSONB string
}

export async function getCanonicalEventsWithoutImage(): Promise<CanonicalEventWithoutImage[]> {
  const result = await pool.query(`
    SELECT id, title, source_priority_winner, sources
    FROM canonical_events
    WHERE image_url IS NULL OR image_url = ''
    ORDER BY created_at DESC
  `);
  return result.rows;
}

// Canonical 이벤트 이미지 업데이트
export async function updateCanonicalEventImage(id: string, imageUrl: string) {
  await pool.query(
    `
      UPDATE canonical_events
      SET image_url = $1, updated_at = NOW()
      WHERE id = $2
    `,
    [imageUrl, id],
  );
}

// Raw 이벤트 payload 조회
export async function getRawEventPayload(rawTable: string, rawId: string): Promise<Record<string, unknown> | null> {
  // SQL injection 방지를 위한 테이블명 검증
  const validTables = ['raw_kopis_events', 'raw_culture_events', 'raw_tour_events'];
  if (!validTables.includes(rawTable)) {
    throw new Error(`Invalid table name: ${rawTable}`);
  }

  const result = await pool.query(`SELECT payload FROM ${rawTable} WHERE id = $1`, [rawId]);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].payload as Record<string, unknown>;
}

// 카테고리 정규화용: 모든 Canonical 이벤트 조회
export interface CanonicalEventForNormalization {
  id: string;
  title: string;
  main_category: string | null;
  sub_category: string | null;
  source_priority_winner: string;
  sources: string; // JSONB string
}

export async function getAllCanonicalEventsForNormalization(): Promise<CanonicalEventForNormalization[]> {
  const result = await pool.query(`
    SELECT id, title, main_category, sub_category, source_priority_winner, sources
    FROM canonical_events
    ORDER BY created_at DESC
  `);
  return result.rows;
}

// Canonical 이벤트 카테고리 업데이트
export async function updateCanonicalEventCategories(
  id: string,
  mainCategory: string,
  subCategory: string,
  sourcePriorityWinner: string,
) {
  await pool.query(
    `
      UPDATE canonical_events
      SET
        main_category = $1,
        sub_category = $2,
        source_priority_winner = $3,
        updated_at = NOW()
      WHERE id = $4
    `,
    [mainCategory, subCategory, sourcePriorityWinner, id],
  );
}

// ========== Phase 3: Canonical Re-merge 관련 함수 ==========

// Canonical 이벤트 Re-merge용 조회 인터페이스
export interface CanonicalEventForRemerge {
  id: string;
  canonical_key: string;
  title: string;
  start_at: string | null;
  end_at: string | null;
  venue: string | null;
  region: string | null;
  main_category: string | null;
  sub_category: string | null;
  image_url: string | null;
  source_priority_winner: string;
  sources: string; // JSONB string
  updated_at: Date;
}

// 모든 Canonical 이벤트 조회 (Re-merge용)
export async function getAllCanonicalEventsForRemerge(): Promise<CanonicalEventForRemerge[]> {
  const result = await pool.query(`
    SELECT
      id, canonical_key, title, start_at, end_at, venue, region,
      main_category, sub_category, image_url,
      source_priority_winner, sources, updated_at
    FROM canonical_events
    WHERE is_deleted = false
    ORDER BY title, start_at, end_at, region
  `);
  return result.rows;
}

// Canonical 이벤트 업데이트 (Re-merge 후)
export interface CanonicalEventUpdateFields {
  venue?: string;
  imageUrl?: string;
  sources?: unknown[];
  sourcePriorityWinner?: string;
  displayTitle?: string;
  contentKey?: string;
}

export async function updateCanonicalEventAfterRemerge(
  id: string,
  fields: CanonicalEventUpdateFields,
) {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (fields.venue !== undefined) {
    // manually_edited_fields->venue 보호: 수동 편집된 경우 덮어쓰지 않음
    updates.push(`venue = CASE WHEN (manually_edited_fields->>'venue')::boolean = true THEN venue ELSE $${paramIndex++} END`);
    params.push(fields.venue);
  }
  if (fields.imageUrl !== undefined) {
    // 기존에 실제 이미지가 있으면 유지
    updates.push(`image_url = CASE WHEN image_url IS NOT NULL AND image_url != '' AND image_url NOT LIKE '%placeholder%' THEN image_url ELSE $${paramIndex++} END`);
    params.push(fields.imageUrl);
  }
  if (fields.sources !== undefined) {
    updates.push(`sources = $${paramIndex++}`);
    params.push(JSON.stringify(fields.sources));
  }
  if (fields.sourcePriorityWinner !== undefined) {
    updates.push(`source_priority_winner = $${paramIndex++}`);
    params.push(fields.sourcePriorityWinner);
  }
  if (fields.displayTitle !== undefined) {
    // manually_edited_fields->display_title 보호
    updates.push(`display_title = CASE WHEN (manually_edited_fields->>'display_title')::boolean = true THEN display_title ELSE $${paramIndex++} END`);
    params.push(fields.displayTitle);
  }
  if (fields.contentKey !== undefined) {
    updates.push(`content_key = $${paramIndex++}`);
    params.push(fields.contentKey);
  }

  if (updates.length === 0) return;

  updates.push(`updated_at = NOW()`);
  params.push(id);

  await pool.query(
    `UPDATE canonical_events SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    params,
  );
}

// Canonical 이벤트 삭제 (여러 개)
export async function deleteCanonicalEvents(ids: string[]) {
  if (ids.length === 0) return;

  await pool.query(
    `DELETE FROM canonical_events WHERE id = ANY($1)`,
    [ids],
  );
}
