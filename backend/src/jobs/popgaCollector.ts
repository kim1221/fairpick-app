/**
 * popgaCollector — 팝가(popga.co.kr) 이벤트 자동 수집 Job
 *
 * 동작:
 *  1. popga 웹 API (popga.co.kr/api) → 전체 진행중·예정 이벤트 목록 (페이지네이션)
 *  2. popga ID 우선, 제목+기간+장소 보조 규칙으로 중복 병합
 *  3. 상세 API 호출 → Gemini AI 정보 추출
 *  4. 이미지 R2 업로드 → DB 직접 삽입 (HTTP 자기호출 방지)
 *
 * 스케줄: 매일 06:00 KST (scheduler.ts)
 * 수동 실행: Admin 운영센터 → "팝가 수집" → 지금 실행
 */

import axios from 'axios';
import { pool } from '../db';
import { uploadEventImage } from '../lib/imageUpload';
import { extractEventInfoEnhanced } from '../lib/aiExtractor';
import { generateContentKey, generateDisplayTitle } from '../utils/titleNormalizer';
import {
  fetchPopgaEventList,
  fetchPopgaSpotDetail,
  POPGA_API_HEADERS,
  POPGA_WEB_BASE,
  PopgaSpot,
} from './popgaApiClient';
import {
  popgaEventStatus,
  requirePopgaEventDate,
  resolvePopgaEndDate,
  stablePopgaEventId,
} from './popgaEventFields';

// ─── 설정 ──────────────────────────────────────────────────────────────────

// Gemini 비용 폭증 방지용 신규 등록 안전장치. 목록 자체는 항상 끝까지 검증한다.
const configuredMaxNewEvents = Number(process.env.POPGA_MAX_NEW_EVENTS_PER_RUN ?? 500);
const MAX_NEW_EVENTS_PER_RUN = Number.isInteger(configuredMaxNewEvents) && configuredMaxNewEvents > 0
  ? configuredMaxNewEvents
  : 500;
const DETAIL_BASE = POPGA_WEB_BASE;
const JOB_NAME = 'popga-collector';

type ProtectedField = 'title' | 'display_title' | 'start_at' | 'end_at' | 'venue' | 'address' | 'main_category' | 'sub_category';

function protectedFieldSql(field: ProtectedField): string {
  return `(
    COALESCE((manually_edited_fields->>'${field}')::boolean, false)
    OR LOWER(COALESCE(field_sources->'${field}'->>'source', '')) LIKE '%manual%'
    OR LOWER(COALESCE(field_sources->'${field}'->>'source', '')) LIKE '%admin%'
  )`;
}

const PROTECTED = {
  title: protectedFieldSql('title'),
  displayTitle: protectedFieldSql('display_title'),
  startAt: protectedFieldSql('start_at'),
  endAt: protectedFieldSql('end_at'),
  venue: protectedFieldSql('venue'),
  address: protectedFieldSql('address'),
  mainCategory: protectedFieldSql('main_category'),
  subCategory: protectedFieldSql('sub_category'),
};

// ─── 유틸 ──────────────────────────────────────────────────────────────────

function toCategory(type: string | undefined): string {
  if (!type) return '팝업';
  return type.toUpperCase() === 'EXHIBITION' ? '전시' : '팝업';
}

/** "@수원" → "(수원)" 변환. 제목 끝의 @지역 패턴만 변환. */
function normalizeTitle(raw: string): string {
  return raw.replace(/\s*@(\S+)$/, ' ($1)');
}

function normalizeImageUrl(path: string | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `https://popga.co.kr${path.startsWith('/') ? '' : '/'}${path}`;
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      headers: {
        ...POPGA_API_HEADERS,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    return Buffer.from(res.data);
  } catch (err: any) {
    console.warn(`[${JOB_NAME}] 이미지 다운로드 실패 (${url}): ${err?.message}`);
    return null;
  }
}

interface ExistingEvent {
  id: string;
  isDeleted: boolean;
  deletedReason: string | null;
  popgaOwned: boolean;
  venue: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  manualFields: Record<string, unknown>;
  fieldSources: Record<string, any>;
}

interface RefreshParams {
  title: string;
  startAt: string;
  endAt: string;
  venue: string;
  address: string;
  imageUrl: string | null;
  popgaId: string | number;
  tags: string[];
  openEnded: boolean;
}

interface RefreshedGeo {
  lat: number;
  lng: number;
  region: string | null;
  source: string;
  confidence: string;
  reason: string | null;
}

function popgaSource(popgaId: string | number) {
  return {
    source: 'popga',
    sourceEventId: String(popgaId),
    sourceUrl: `${DETAIL_BASE}/popup/${popgaId}`,
    collectedBy: JOB_NAME,
    collectedAt: new Date().toISOString(),
  };
}

async function findByPopgaId(popgaId: string | number): Promise<ExistingEvent | null> {
  const result = await pool.query<ExistingEvent>(
    `SELECT id,
            is_deleted AS "isDeleted",
            deleted_reason AS "deletedReason",
            venue,
            address,
            lat,
            lng,
            COALESCE(manually_edited_fields, '{}'::jsonb) AS "manualFields",
            COALESCE(field_sources, '{}'::jsonb) AS "fieldSources",
            CASE
              WHEN COALESCE(metadata->>'popga_owned', 'false') = 'true'
                   AND metadata->>'popga_id' = $2 THEN true
              WHEN canonical_key = $4 THEN true
              WHEN metadata->>'source' = $3
                   AND (metadata->>'popga_id' IS NULL OR metadata->>'popga_id' = $2)
                THEN true
              ELSE false
            END AS "popgaOwned"
     FROM canonical_events
     WHERE source_tags @> $1::jsonb
        OR metadata->>'popga_id' = $2
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(COALESCE(sources, '[]'::jsonb)) = 'array'
              THEN COALESCE(sources, '[]'::jsonb) ELSE '[]'::jsonb END
          ) entry
          WHERE entry->>'source' = 'popga'
            AND COALESCE(entry->>'sourceEventId', entry->>'source_event_id') = $2
        )
     ORDER BY is_deleted ASC, updated_at DESC NULLS LAST
     LIMIT 1`,
    [
      JSON.stringify([`popga:${popgaId}`]),
      String(popgaId),
      JOB_NAME,
      `popga:${popgaId}`,
    ],
  );
  return result.rows[0] ?? null;
}

async function findMatchingEvent(
  title: string,
  venue: string,
  address: string,
  startAt: string,
  endAt: string,
  category: string,
): Promise<{ id: string } | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM canonical_events
     WHERE is_deleted = false
       AND main_category = $6
       AND start_at::date = $4::date
       AND end_at::date = $5::date
       AND similarity(title, $1) >= CASE
         WHEN $2 <> '' AND COALESCE(venue, '') <> '' THEN 0.82
         WHEN $3 <> '' AND COALESCE(address, '') <> '' THEN 0.88
         ELSE 0.96
       END
       AND (
         ($2 <> '' AND COALESCE(venue, '') <> '' AND (
           venue ILIKE $2
           OR venue ILIKE '%' || $2 || '%'
           OR $2 ILIKE '%' || venue || '%'
         ))
         OR ($3 <> '' AND COALESCE(address, '') <> '' AND (
           address ILIKE $3
           OR address ILIKE '%' || $3 || '%'
           OR $3 ILIKE '%' || address || '%'
         ))
         OR (
           ($2 = '' OR COALESCE(venue, '') = '')
           AND ($3 = '' OR COALESCE(address, '') = '')
           AND similarity(title, $1) >= 0.96
         )
       )
     ORDER BY similarity(title, $1) DESC
     LIMIT 1`,
    [title, venue, address, startAt, endAt, category],
  );
  return result.rows[0] ?? null;
}

function fallbackSubCategory(category: string): string {
  return category === '전시' ? '기타 전시' : '기타 팝업';
}

/** @internal exported for collector SQL contract verification. */
export async function refreshOwnedEvent(
  eventId: string,
  p: RefreshParams,
  category: string,
  geo: RefreshedGeo | null = null,
): Promise<boolean> {
  const incomingTags = [
    ...p.tags.filter((tag) => tag && tag.trim()),
    'popga_collector',
    `popga:${p.popgaId}`,
  ];
  const source = popgaSource(p.popgaId);

  const result = await pool.query(
    `UPDATE canonical_events
     SET
       title = CASE
         WHEN ${PROTECTED.title} THEN title
         ELSE $2
       END,
       display_title = CASE
         WHEN ${PROTECTED.title} OR ${PROTECTED.displayTitle} THEN display_title
         ELSE $22
       END,
       start_at = CASE
         WHEN ${PROTECTED.startAt} THEN start_at
         ELSE $3::date
       END,
       end_at = CASE
         WHEN ${PROTECTED.endAt} THEN end_at
         ELSE $4::date
       END,
       venue = CASE
         WHEN ${PROTECTED.venue} THEN venue
         WHEN $15::boolean = false THEN venue
         ELSE COALESCE(NULLIF($5, ''), venue)
       END,
       address = CASE
         WHEN ${PROTECTED.address} THEN address
         WHEN $15::boolean = false THEN address
         ELSE COALESCE(NULLIF($6, ''), address)
       END,
       lat = CASE
         WHEN $15::boolean AND NOT COALESCE((manually_edited_fields->>'lat')::boolean, false)
         THEN $16::double precision ELSE lat END,
       lng = CASE
         WHEN $15::boolean AND NOT COALESCE((manually_edited_fields->>'lng')::boolean, false)
         THEN $17::double precision ELSE lng END,
       region = CASE
         WHEN $15::boolean AND NOT COALESCE((manually_edited_fields->>'region')::boolean, false)
         THEN COALESCE($18, region) ELSE region END,
       geo_source = CASE WHEN $15::boolean THEN $19 ELSE geo_source END,
       geo_confidence = CASE WHEN $15::boolean THEN $20 ELSE geo_confidence END,
       geo_reason = CASE WHEN $15::boolean THEN $21 ELSE geo_reason END,
       geo_updated_at = CASE WHEN $15::boolean THEN NOW() ELSE geo_updated_at END,
       main_category = CASE
         WHEN ${PROTECTED.mainCategory} THEN main_category
         ELSE $12
       END,
       sub_category = CASE
         WHEN ${PROTECTED.subCategory} THEN sub_category
         WHEN main_category IS DISTINCT FROM $12 THEN $13
         ELSE COALESCE(NULLIF(sub_category, ''), $13)
       END,
       source_priority_winner = 'popga',
       image_url = CASE
         WHEN COALESCE((image_metadata->>'dmca_takedown')::boolean, false) THEN image_url
         WHEN COALESCE((manually_edited_fields->>'image_url')::boolean, false) THEN image_url
         WHEN LOWER(COALESCE(field_sources->'image_url'->>'source', '')) LIKE '%manual%' THEN image_url
         WHEN LOWER(COALESCE(field_sources->'image_url'->>'source', '')) LIKE '%admin%' THEN image_url
         WHEN image_url IS NULL OR image_url = '' OR image_url LIKE '%/defaults/%'
         THEN COALESCE($7, image_url)
         ELSE image_url
       END,
       source_tags = (
         SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb)
         FROM jsonb_array_elements(
           (CASE WHEN jsonb_typeof(COALESCE(canonical_events.source_tags, '[]'::jsonb)) = 'array'
             THEN COALESCE(canonical_events.source_tags, '[]'::jsonb) ELSE '[]'::jsonb END)
           || $8::jsonb
         ) tag
       ),
       sources = CASE
         WHEN EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(COALESCE(canonical_events.sources, '[]'::jsonb)) = 'array'
               THEN COALESCE(canonical_events.sources, '[]'::jsonb) ELSE '[]'::jsonb END
           ) entry
           WHERE entry->>'source' = 'popga'
             AND entry->>'sourceEventId' = $9
         ) THEN sources
         ELSE (CASE WHEN jsonb_typeof(COALESCE(sources, '[]'::jsonb)) = 'array'
           THEN COALESCE(sources, '[]'::jsonb) ELSE '[]'::jsonb END) || $10::jsonb
       END,
       is_deleted = false,
       deleted_reason = NULL,
       deleted_at = NULL,
       status = CASE
         WHEN (
           CASE WHEN ${PROTECTED.startAt}
             THEN start_at::date ELSE $3::date END
         ) > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date THEN 'scheduled'
         WHEN (
           CASE WHEN ${PROTECTED.endAt}
             THEN end_at::date ELSE $4::date END
         ) < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date THEN 'ended'
         ELSE 'ongoing'
       END,
       is_ending_soon = CASE
         WHEN ${PROTECTED.endAt} THEN is_ending_soon
         WHEN $11::boolean THEN false
         ELSE $4::date BETWEEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date
           AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date + 7
       END,
       last_collected_at = NOW(),
       last_collector_source = 'popga',
       external_links = COALESCE(external_links, '{}'::jsonb)
         || jsonb_build_object('popga', $14::text),
       metadata = jsonb_set(
         jsonb_set(
           jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{popga_open_ended}',
             CASE
               WHEN ${PROTECTED.endAt}
               THEN COALESCE(metadata->'popga_open_ended', 'false'::jsonb)
               ELSE to_jsonb($11::boolean)
             END,
             true
           ),
           '{popga_id}',
           COALESCE(metadata->'popga_id', to_jsonb($9::text)),
           true
         ),
         '{popga_owned}',
         'true'::jsonb,
         true
       ),
       ingest_change_type = CASE
         WHEN (
             NOT ${PROTECTED.title}
             AND title IS DISTINCT FROM $2
           )
           OR (
             NOT ${PROTECTED.startAt}
             AND start_at::date IS DISTINCT FROM $3::date
           )
           OR (
             NOT ${PROTECTED.endAt}
             AND end_at::date IS DISTINCT FROM $4::date
           )
           OR $15::boolean
           OR (
             $7 IS NOT NULL
             AND NOT COALESCE((image_metadata->>'dmca_takedown')::boolean, false)
             AND NOT COALESCE((manually_edited_fields->>'image_url')::boolean, false)
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%manual%'
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%admin%'
             AND (image_url IS NULL OR image_url = '' OR image_url LIKE '%/defaults/%')
           )
           OR (
             NOT ${PROTECTED.mainCategory}
             AND main_category IS DISTINCT FROM $12
           )
           OR (
             NOT ${PROTECTED.subCategory}
             AND (sub_category IS NULL OR sub_category = '')
           )
           OR is_deleted = true
         THEN 'updated'
         ELSE 'unchanged'
       END,
       updated_at = CASE
         WHEN (
             NOT ${PROTECTED.title}
             AND title IS DISTINCT FROM $2
           )
           OR (
             NOT ${PROTECTED.startAt}
             AND start_at::date IS DISTINCT FROM $3::date
           )
           OR (
             NOT ${PROTECTED.endAt}
             AND end_at::date IS DISTINCT FROM $4::date
           )
           OR $15::boolean
           OR (
             $7 IS NOT NULL
             AND NOT COALESCE((image_metadata->>'dmca_takedown')::boolean, false)
             AND NOT COALESCE((manually_edited_fields->>'image_url')::boolean, false)
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%manual%'
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%admin%'
             AND (image_url IS NULL OR image_url = '' OR image_url LIKE '%/defaults/%')
           )
           OR (
             NOT ${PROTECTED.mainCategory}
             AND main_category IS DISTINCT FROM $12
           )
           OR (
             NOT ${PROTECTED.subCategory}
             AND (sub_category IS NULL OR sub_category = '')
           )
           OR is_deleted = true
         THEN NOW()
         ELSE updated_at
       END
     WHERE id = $1
       AND (is_deleted = false OR deleted_reason = 'expired')`,
    [
      eventId,
      p.title,
      p.startAt,
      p.endAt,
      p.venue,
      p.address,
      p.imageUrl,
      JSON.stringify(incomingTags),
      String(p.popgaId),
      JSON.stringify([source]),
      p.openEnded,
      category,
      fallbackSubCategory(category),
      `${DETAIL_BASE}/popup/${p.popgaId}`,
      geo !== null,
      geo?.lat ?? null,
      geo?.lng ?? null,
      geo?.region ?? null,
      geo?.source ?? null,
      geo?.confidence ?? null,
      geo?.reason ?? null,
      generateDisplayTitle(p.title),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 다른 수집원의 canonical에 fuzzy-match된 경우 원본 필드는 덮지 않고 출처와 빈 필드만 보강한다. */
/** @internal exported for collector SQL contract verification. */
export async function attachPopgaProvenance(eventId: string, p: RefreshParams): Promise<void> {
  const incomingTags = [
    ...p.tags.filter((tag) => tag && tag.trim()),
    'popga_collector',
    `popga:${p.popgaId}`,
  ];
  const source = popgaSource(p.popgaId);

  await pool.query(
    `UPDATE canonical_events
     SET
       image_url = CASE
         WHEN COALESCE((image_metadata->>'dmca_takedown')::boolean, false) THEN image_url
         WHEN COALESCE((manually_edited_fields->>'image_url')::boolean, false) THEN image_url
         WHEN LOWER(COALESCE(field_sources->'image_url'->>'source', '')) LIKE '%manual%' THEN image_url
         WHEN LOWER(COALESCE(field_sources->'image_url'->>'source', '')) LIKE '%admin%' THEN image_url
         WHEN image_url IS NULL OR image_url = '' OR image_url LIKE '%/defaults/%'
         THEN COALESCE($2, image_url)
         ELSE image_url
       END,
       source_tags = (
         SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb)
         FROM jsonb_array_elements(
           (CASE WHEN jsonb_typeof(COALESCE(canonical_events.source_tags, '[]'::jsonb)) = 'array'
             THEN COALESCE(canonical_events.source_tags, '[]'::jsonb) ELSE '[]'::jsonb END)
           || $3::jsonb
         ) tag
       ),
       sources = CASE
         WHEN EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(COALESCE(canonical_events.sources, '[]'::jsonb)) = 'array'
               THEN COALESCE(canonical_events.sources, '[]'::jsonb) ELSE '[]'::jsonb END
           ) entry
           WHERE entry->>'source' = 'popga'
             AND COALESCE(entry->>'sourceEventId', entry->>'source_event_id') = $4
         ) THEN sources
         ELSE (CASE WHEN jsonb_typeof(COALESCE(sources, '[]'::jsonb)) = 'array'
           THEN COALESCE(sources, '[]'::jsonb) ELSE '[]'::jsonb END) || $5::jsonb
       END,
       external_links = COALESCE(external_links, '{}'::jsonb)
         || jsonb_build_object('popga', $6::text),
       metadata = CASE
         -- 이미 Popga가 원본인 canonical에 다른 Popga ID가 병합되더라도
         -- primary ID와 소유권을 잃지 않는다. 추가 ID는 sources 배열로 추적한다.
         WHEN COALESCE(metadata->>'popga_owned', 'false') = 'true'
         THEN COALESCE(metadata, '{}'::jsonb)
         ELSE jsonb_set(
           jsonb_set(
             jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{popga_source_open_ended}',
               to_jsonb($7::boolean),
               true
             ),
             '{popga_id}',
             to_jsonb($4::text),
             true
           ),
           '{popga_owned}',
           'false'::jsonb,
           true
         )
       END,
       status = CASE
         WHEN start_at::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date THEN 'scheduled'
         WHEN end_at::date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date THEN 'ended'
         ELSE 'ongoing'
       END,
       last_collected_at = NOW(),
       last_collector_source = 'popga',
       ingest_change_type = CASE
         WHEN (
             $2 IS NOT NULL
             AND NOT COALESCE((image_metadata->>'dmca_takedown')::boolean, false)
             AND NOT COALESCE((manually_edited_fields->>'image_url')::boolean, false)
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%manual%'
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%admin%'
             AND (image_url IS NULL OR image_url = '' OR image_url LIKE '%/defaults/%')
           )
         THEN 'updated'
         ELSE 'unchanged'
       END,
       updated_at = CASE
         WHEN (
             $2 IS NOT NULL
             AND NOT COALESCE((image_metadata->>'dmca_takedown')::boolean, false)
             AND NOT COALESCE((manually_edited_fields->>'image_url')::boolean, false)
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%manual%'
             AND LOWER(COALESCE(field_sources->'image_url'->>'source', '')) NOT LIKE '%admin%'
             AND (image_url IS NULL OR image_url = '' OR image_url LIKE '%/defaults/%')
           )
         THEN NOW()
         ELSE updated_at
       END
     WHERE id = $1
       AND is_deleted = false`,
    [
      eventId,
      p.imageUrl,
      JSON.stringify(incomingTags),
      String(p.popgaId),
      JSON.stringify([source]),
      `${DETAIL_BASE}/popup/${p.popgaId}`,
      p.openEnded,
    ],
  );
}

// ─── 상세 API ──────────────────────────────────────────────────────────────

interface PopgaDetail {
  obj: any;
  searchText: string;
  instagramUrl: string | null;
  hasMate: boolean;
}

/**
 * 팝가 웹 API에서 단건 상세 데이터를 가져온다.
 * GET https://popga.co.kr/api/spots/{id}
 */
async function fetchDetail(popgaId: string | number): Promise<PopgaDetail> {
  let detail: any;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      detail = await fetchPopgaSpotDetail(popgaId);
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        console.warn(`[${JOB_NAME}] 상세 API 재시도 (id=${popgaId}, attempt=${attempt + 1}/2)`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  if (!detail) throw lastError;

  const instagramUrl: string | null =
    detail.website?.instagram ?? detail.instagram ?? detail.sns?.instagram ?? null;

  const benefitLines: string[] = [];
  if (Array.isArray(detail.benefits)) {
    for (const b of detail.benefits) {
      if (b.key && b.value) benefitLines.push(`${b.key}: ${b.value}`);
      else if (b.value) benefitLines.push(b.value);
    }
  }

  const categoryNames: string[] = Array.isArray(detail.categories)
    ? detail.categories.map((c: any) => c.name).filter(Boolean)
    : [];

  const parts: string[] = [];
  if (detail.title)         parts.push(`이벤트명: ${detail.title}`);
  if (categoryNames.length) parts.push(`카테고리: ${categoryNames.join(', ')}`);
  if (detail.content)       parts.push(`설명:\n${detail.content}`);
  if (detail.address)       parts.push(`주소: ${detail.address}`);
  if (detail.addressDetail) parts.push(`장소: ${detail.addressDetail}`);
  if (detail.openDate)      parts.push(`시작일: ${detail.openDate}`);
  if (detail.closeDate)     parts.push(`종료일: ${detail.closeDate}`);
  if (Array.isArray(detail.operationTime) && detail.operationTime.length > 0)
    parts.push(`운영시간: ${detail.operationTime.join(', ')}`);
  if (benefitLines.length)  parts.push(`혜택:\n${benefitLines.join('\n')}`);
  if (detail.additionalInformation) parts.push(`추가정보: ${detail.additionalInformation}`);
  if (detail.notice)        parts.push(`공지: ${detail.notice}`);
  if (Array.isArray(detail.tags) && detail.tags.length > 0)
    parts.push(`태그: ${(detail.tags as string[]).join(', ')}`);
  if (instagramUrl)         parts.push(`인스타그램: ${instagramUrl}`);

  const mate =
    detail.aiSupplement ??
    detail.mate ??
    detail.aiMate ??
    detail.ai_mate ??
    detail.analysis ??
    detail.aiAnalysis ??
    detail.insight ??
    detail.crowdInfo ??
    detail.crowd_info ??
    null;

  const hasMate = mate !== null;
  if (hasMate) {
    const mateText = typeof mate === 'string' ? mate : JSON.stringify(mate);
    parts.push(`AI 분석:\n${mateText}`);
  }

  return { obj: detail, searchText: parts.join('\n'), instagramUrl, hasMate };
}

// ─── DB 직접 삽입 ──────────────────────────────────────────────────────────
//
// HTTP 자기호출(POST /admin/events/popup) 대신 DB에 직접 삽입.
// 이벤트 루프 블로킹으로 인해 자기 서버 HTTP 요청이 timeout되는 문제 방지.

export interface InsertParams {
  popgaId: string | number;
  title: string;
  category: string;
  startAt: string;
  endAt: string;
  venue: string;
  address: string | null;
  imageUrl: string | null;
  imageStorage: string;
  imageOrigin: string | undefined;
  imageKey: string | null;
  overview: string | null;
  instagramUrl: string | null;
  is_free: boolean | null;
  price_info: string | null;
  price_min: number | null;
  price_max: number | null;
  opening_hours: any;
  parking_available: boolean | null;
  parking_info: string | null;
  source_tags: string[];
  derived_tags: string[];
  external_links: Record<string, string>;
  metadata: any;
}

/** @internal exported for collector SQL contract verification. */
export async function insertEventDirect(
  p: InsertParams,
  db: { query: (...args: any[]) => Promise<any> } = pool as any,
): Promise<string | null> {
  const id = stablePopgaEventId(p.popgaId);
  // is_ending_soon
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const daysUntilEnd = Math.ceil(
    (Date.parse(`${p.endAt}T00:00:00Z`) - Date.parse(`${todayKst}T00:00:00Z`)) /
      (1_000 * 60 * 60 * 24),
  );
  const isEndingSoon = p.metadata?.popga_open_ended === true
    ? false
    : daysUntilEnd <= 7 && daysUntilEnd >= 0;

  // 지오코딩
  let lat: number | null = null;
  let lng: number | null = null;
  let region: string | null = null;
  let geoSource: string | null = null;
  let geoConfidence: string | null = null;
  let geoReason: string | null = null;

  if (p.address || p.venue) {
    try {
      const { geocodeBestEffort } = await import('../lib/geocode');
      const geo = await geocodeBestEffort({ address: p.address ?? undefined, venue: p.venue });
      lat = geo.lat;
      lng = geo.lng;
      region = geo.region;
      const srcMap: Record<string, string> = {
        kakao_address: 'kakao', kakao_keyword: 'kakao', nominatim: 'nominatim', failed: 'manual',
      };
      geoSource = srcMap[geo.source] || 'manual';
      geoConfidence = geo.confidence;
      geoReason = geo.reason;
    } catch (e: any) {
      geoSource = 'manual';
      geoConfidence = 'D';
      geoReason = `geocode_error: ${e?.message ?? String(e)}`;
    }
  }

  // price_info 기본값 (팝업은 null로 들어오므로 fallback 사용)
  const fallbackPriceInfo = p.category === '팝업' ? null : p.price_info;
  const finalPriceInfo = fallbackPriceInfo;
  const finalIsFree = p.is_free;   // 팝업은 null, 전시는 AI 판단값

  const sourcesData = [{
    ...popgaSource(p.popgaId),
    instagramUrl: p.instagramUrl || null,
  }];

  const qualityFlags = {
    has_real_image: !!(p.imageUrl && !p.imageUrl.includes('/defaults/')),
    has_exact_address: !!p.address,
    geo_ok: !!(lat && lng),
    has_overview: !!p.overview,
    has_price_info: !!finalPriceInfo,
  };

  // 다른 수집기와 동일한 공용 규칙을 사용해 후속 중복 정리 결과를 안정화한다.
  const normalizedTitle = generateDisplayTitle(p.title);
  const contentKey = generateContentKey(
    p.title,
    p.startAt,
    p.endAt,
    p.venue,
    region,
    p.category,
  );

  const result = await db.query(
    `INSERT INTO canonical_events (
      id, content_key, title, display_title, start_at, end_at, venue, address,
      region, lat, lng, main_category, sub_category, image_url, is_free, price_info,
      overview, is_ending_soon, popularity_score, buzz_score, is_featured, featured_order,
      featured_at, sources, source_priority_winner, is_deleted, deleted_reason,
      image_storage, image_origin, image_source_page_url, image_key, image_metadata,
      geo_source, geo_confidence, geo_reason, geo_updated_at,
      external_links, status, price_min, price_max, source_tags, derived_tags,
      opening_hours, parking_available, parking_info, quality_flags,
      metadata, created_source, first_collected_at, last_collected_at,
      last_collector_source, ingest_change_type, canonical_key, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,
      $28,$29,$30,$31,$32::jsonb,
      $33,$34,$35,$36,
      $37::jsonb,$38,$39,$40,$41::jsonb,$42::jsonb,
      $43::jsonb,$44,$45,$46::jsonb,
      $47::jsonb, $48, NOW(), NOW(), $49, $50, $51, NOW(), NOW()
    )
    ON CONFLICT (canonical_key) DO NOTHING
    RETURNING id`,
    [
      id, contentKey, p.title, normalizedTitle,
      p.startAt, p.endAt, p.venue, p.address || null,
      region, lat, lng,
      p.category, fallbackSubCategory(p.category),
      p.imageUrl || null,
      finalIsFree, finalPriceInfo,
      p.overview || null,
      isEndingSoon,
      500, 0, false, null, null,
      JSON.stringify(sourcesData),
      'popga', false, null,
      p.imageStorage || 'external',
      p.imageOrigin || null,
      p.imageUrl ? `${DETAIL_BASE}/popup/${p.popgaId}` : null,
      p.imageKey || null,
      '{}',
      geoSource, geoConfidence, geoReason,
      geoSource ? new Date() : null,
      JSON.stringify(p.external_links || {}),
      popgaEventStatus(p.startAt, p.endAt),
      p.price_min ?? null, p.price_max ?? null,
      JSON.stringify(p.source_tags || []),
      JSON.stringify(p.derived_tags || []),
      p.opening_hours ? JSON.stringify(p.opening_hours) : null,
      p.parking_available ?? null,
      p.parking_info || null,
      JSON.stringify(qualityFlags),
      p.metadata ? JSON.stringify(p.metadata) : null,
      'public_api',
      'popga',
      'new',
      `popga:${p.popgaId}`,
    ],
  );

  return result.rows[0]?.id ?? null;
}

// ─── 단일 이벤트 처리 ──────────────────────────────────────────────────────

type ProcessOutcome = 'created' | 'existing' | 'merged' | 'deferred';

function spotImagePath(spot: any): string | undefined {
  const files: any[] = Array.isArray(spot?.files) ? spot.files : [];
  const preferred = files.find((file) => file?.type === 'MAIN_W480') ?? files[0];
  return preferred?.path ?? spot?.file?.path ?? spot?.thumbnail ?? spot?.imageUrl;
}

function stringTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (tag): tag is string => typeof tag === 'string' && tag.trim().length > 0,
  );
}

function normalizedLocationText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function geocodeChangedLocation(
  existing: ExistingEvent,
  venue: string,
  address: string,
): Promise<RefreshedGeo | null> {
  const manual = existing.manualFields ?? {};
  const fieldSources = existing.fieldSources ?? {};
  const isProtected = (field: string) => {
    const source = String(fieldSources[field]?.source ?? '').toLowerCase();
    return manual[field] === true || source.includes('manual') || source.includes('admin');
  };
  if (['venue', 'address', 'lat', 'lng', 'region'].some(isProtected)) {
    return null;
  }

  const venueChanged = venue.trim() !== '' &&
    normalizedLocationText(venue) !== normalizedLocationText(existing.venue);
  const addressChanged = address.trim() !== '' &&
    normalizedLocationText(address) !== normalizedLocationText(existing.address);
  const coordinatesMissing = existing.lat === null || existing.lng === null;
  if (!venueChanged && !addressChanged && !coordinatesMissing) return null;
  if (!venue.trim() && !address.trim()) return null;

  try {
    const { geocodeBestEffort } = await import('../lib/geocode');
    const result = await geocodeBestEffort({
      address: address || undefined,
      venue: venue || existing.venue || undefined,
    });
    if (result.lat === null || result.lng === null) {
      console.warn(`[${JOB_NAME}] 위치 변경 감지했지만 지오코딩 실패 — 기존 위치 보존`);
      return null;
    }
    const sourceMap: Record<string, string> = {
      kakao_address: 'kakao',
      kakao_keyword: 'kakao',
      nominatim: 'nominatim',
      failed: 'manual',
    };
    return {
      lat: result.lat,
      lng: result.lng,
      region: result.region,
      source: sourceMap[result.source] || 'manual',
      confidence: result.confidence,
      reason: result.reason,
    };
  } catch (error: any) {
    console.warn(`[${JOB_NAME}] 위치 변경 지오코딩 오류 — 기존 위치 보존: ${error?.message}`);
    return null;
  }
}

async function processEvent(
  item: PopgaSpot,
  index: number,
  allowCreate: boolean,
): Promise<ProcessOutcome> {
  const spot: any = item;
  const popgaId = item.id;
  const listType: string = spot.type ?? spot.category ?? spot.eventType ?? 'STORE';
  const listTitle = normalizeTitle(item.title);

  console.log(`[${JOB_NAME}] [${index + 1}] "${listTitle}" (popga:${popgaId})`);

  const listStartAt = requirePopgaEventDate(
    spot.openDate ?? spot.startAt ?? spot.startDate,
    '시작일',
    popgaId,
  );
  const listEnd = resolvePopgaEndDate(
    spot.closeDate ?? spot.endAt ?? spot.endDate,
    listStartAt,
    popgaId,
  );
  const listEndAt = listEnd.endAt;
  const listVenue: string = spot.addressDetail ?? spot.placeName ?? spot.venue ?? '';
  const listAddress: string = spot.address ?? spot.fullAddress ?? spot.roadAddress ?? '';
  const listImageUrl = normalizeImageUrl(spotImagePath(spot));
  const listTags = stringTags(spot.tags);

  const existingBySource = await findByPopgaId(popgaId);
  if (existingBySource) {
    if (existingBySource.isDeleted && existingBySource.deletedReason !== 'expired') {
      console.log(
        `[${JOB_NAME}]   → 관리자/정책 삭제 유지 (reason=${existingBySource.deletedReason ?? 'unknown'})`,
      );
      return 'existing';
    }

    const refreshParams: RefreshParams = {
      title: listTitle,
      startAt: listStartAt,
      endAt: listEndAt,
      venue: listVenue,
      address: listAddress,
      imageUrl: listImageUrl,
      popgaId,
      tags: listTags,
      openEnded: listEnd.openEnded,
    };

    if (existingBySource.popgaOwned) {
      const refreshedGeo = await geocodeChangedLocation(
        existingBySource,
        listVenue,
        listAddress,
      );
      const refreshed = await refreshOwnedEvent(
        existingBySource.id,
        refreshParams,
        toCategory(listType),
        refreshedGeo,
      );
      if (!refreshed) {
        console.log(`[${JOB_NAME}]   → 갱신 직전 삭제 상태 변경 감지 — 삭제 유지`);
        return 'existing';
      }
      console.log(`[${JOB_NAME}]   → 기존 popga 원본 이벤트 갱신`);
    } else {
      if (existingBySource.isDeleted) {
        console.log(`[${JOB_NAME}]   → 병합된 삭제 이벤트는 자동 부활하지 않음`);
        return 'existing';
      }
      await attachPopgaProvenance(existingBySource.id, refreshParams);
      console.log(`[${JOB_NAME}]   → 병합 이벤트의 popga 출처 갱신 (원본 필드 보존)`);
    }
    return 'existing';
  }

  if (!allowCreate) {
    console.log(`[${JOB_NAME}]   → 신규 등록 상한 도달 — 다음 실행으로 이월`);
    return 'deferred';
  }

  // 상세 API
  const detail = await fetchDetail(popgaId);
  const detailTitle = normalizeTitle(detail.obj?.title || listTitle);
  const type: string = detail.obj?.type ?? listType;
  const category = toCategory(type);
  const startAt = requirePopgaEventDate(detail.obj?.openDate ?? listStartAt, '시작일', popgaId);
  const detailEnd = resolvePopgaEndDate(
    detail.obj?.closeDate ?? spot.closeDate ?? spot.endAt ?? spot.endDate,
    startAt,
    popgaId,
  );
  const endAt = detailEnd.endAt;
  const detailVenue: string = detail.obj?.addressDetail || listVenue;
  const detailAddress: string = detail.obj?.address || listAddress;
  const operationTimeRaw: string[] = Array.isArray(spot.operationTime) ? spot.operationTime : [];
  const detailOperationTime: string[] =
    Array.isArray(detail.obj?.operationTime) ? detail.obj.operationTime : operationTimeRaw;
  const detailTags = detail.obj?.tags === undefined ? listTags : stringTags(detail.obj.tags);
  const popgaImageUrl = normalizeImageUrl(spotImagePath(detail.obj) ?? spotImagePath(spot));
  const instagramUrl = detail.instagramUrl;

  const matchingEvent = await findMatchingEvent(
    detailTitle,
    detailVenue,
    detailAddress,
    startAt,
    endAt,
    category,
  );
  if (matchingEvent) {
    await attachPopgaProvenance(matchingEvent.id, {
      title: detailTitle,
      startAt,
      endAt,
      venue: detailVenue,
      address: detailAddress,
      imageUrl: popgaImageUrl,
      popgaId,
      tags: detailTags,
      openEnded: detailEnd.openEnded,
    });
    console.log(`[${JOB_NAME}]   → 동일 기간·장소 이벤트에 popga 출처 병합`);
    return 'merged';
  }

  const searchResults = detail.searchText || [
    `이벤트명: ${detailTitle}`,
    `카테고리: ${category}`,
    detailVenue ? `장소: ${detailVenue}` : '',
    detailAddress ? `주소: ${detailAddress}` : '',
    `기간: ${startAt} ~ ${endAt}`,
    detailOperationTime.length > 0 ? `운영시간: ${detailOperationTime.join(', ')}` : '',
    detailTags.length > 0 ? `태그: ${detailTags.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  // Gemini
  let aiInfo: any = null;
  try {
    aiInfo = await extractEventInfoEnhanced(
      detailTitle, category, null,
      String(new Date().getFullYear()),
      { ticket: [], official: [searchResults], place: [], blog: [] },
    );
    if (aiInfo && !detail.hasMate) {
      aiInfo.parking_available = undefined;
      aiInfo.parking_info = undefined;
    }
    console.log(`[${JOB_NAME}]   → AI 완료: tags=${JSON.stringify(aiInfo?.derived_tags ?? [])}`);
  } catch (err: any) {
    console.warn(`[${JOB_NAME}]   → Gemini 실패: ${err?.message}`);
  }

  // 이미지 R2 업로드
  let uploadedImageUrl: string | null = null;
  let uploadedImageKey: string | null = null;
  let imageStorage = 'external';
  if (popgaImageUrl) {
    const buf = await downloadImage(popgaImageUrl);
    if (buf && buf.length > 0) {
      try {
        const ext = popgaImageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
        const result = await uploadEventImage(buf, `popga_${popgaId}.${ext}`, { checkDuplicate: true });
        uploadedImageUrl = result.url;
        uploadedImageKey = result.key;
        imageStorage = 'cdn';
      } catch (err: any) {
        console.warn(`[${JOB_NAME}]   → R2 업로드 실패: ${err?.message}`);
        uploadedImageUrl = popgaImageUrl;
      }
    } else {
      uploadedImageUrl = popgaImageUrl;
    }
  }

  const sourceTags = [
    ...detailTags.filter((t) => t && t.trim()),
    'popga_collector',
    `popga:${popgaId}`,
  ];

  const popupDisplay = aiInfo?.popup_display ?? null;

  // DB 직접 삽입 (HTTP self-call 대신). 실패는 잡 전체 상태에 반영한다.
  const createdId = await insertEventDirect({
    popgaId,
    title: detailTitle,
    category,
    startAt,
    endAt,
    venue: detailVenue || detailTitle,
    address: detailAddress || null,
    imageUrl: uploadedImageUrl,
    imageStorage,
    imageOrigin: popgaImageUrl ? 'other' : undefined,
    imageKey: uploadedImageKey,
    overview: aiInfo?.overview_raw ?? aiInfo?.overview ?? null,
    instagramUrl,
    is_free: category === '팝업' ? null : (aiInfo?.price_min === 0 ? true : null),
    price_info: category === '팝업' ? null : (
      aiInfo?.price_min === 0 ? '무료'
        : (aiInfo?.price_min != null ? `최소 ${aiInfo.price_min.toLocaleString()}원` : null)
    ),
    price_min: category === '팝업' ? null : (aiInfo?.price_min ?? null),
    price_max: category === '팝업' ? null : (aiInfo?.price_max ?? null),
    opening_hours: aiInfo?.opening_hours ??
      (detailOperationTime.length > 0
        ? { weekday: detailOperationTime[0], weekend: detailOperationTime[0] }
        : null),
    parking_available: aiInfo?.parking_available ?? null,
    parking_info: aiInfo?.parking_info ?? null,
    source_tags: sourceTags,
    derived_tags: aiInfo?.derived_tags ?? [],
    external_links: {
      popga: `${DETAIL_BASE}/popup/${popgaId}`,
      ...(instagramUrl ? { instagram: instagramUrl } : {}),
    },
    metadata: {
      display: popupDisplay ? { popup: popupDisplay } : undefined,
      popga_id: String(popgaId),
      popga_type: type,
      popga_period_type: detail.obj?.periodType ?? spot.periodType ?? null,
      popga_created_at: detail.obj?.createdAt ?? spot.createdAt ?? null,
      popga_updated_at:
        detail.obj?.lastUpdatedAt ?? detail.obj?.updatedAt ??
        spot.lastUpdatedAt ?? spot.updatedAt ?? null,
      popga_open_ended: detailEnd.openEnded,
      popga_owned: true,
      source: JOB_NAME,
    },
  });

  if (!createdId) {
    // 다른 인스턴스가 같은 Popga ID를 먼저 넣은 경우 unique canonical_key가
    // 중복 생성을 막는다. 충돌 행을 다시 확인해 정상적인 기존 처리로 마친다.
    const concurrentExisting = await findByPopgaId(popgaId);
    if (concurrentExisting) {
      console.log(`[${JOB_NAME}]   → 동시 수집 충돌 감지 — 기존 이벤트 사용`);
      return 'existing';
    }
    throw new Error('INSERT returned no id and conflicting Popga event was not found');
  }
  console.log(`[${JOB_NAME}]   ✅ 등록 완료 — id: ${createdId}`);
  return 'created';
}

// ─── 메인 export ───────────────────────────────────────────────────────────

export interface PopgaCollectorResult {
  itemsCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  createdCount: number;
  refreshedCount: number;
  mergedCount: number;
  deferredCount: number;
}

function emptyResult(itemsCount = 0): PopgaCollectorResult {
  return {
    itemsCount,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdCount: 0,
    refreshedCount: 0,
    mergedCount: 0,
    deferredCount: 0,
  };
}

async function fetchValidatedEventList(): Promise<PopgaSpot[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const items = await fetchPopgaEventList();
      if (items.length === 0) {
        throw new Error('팝가가 진행중·예정 이벤트를 0건으로 응답했습니다.');
      }
      return items;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        console.warn(`[${JOB_NAME}] 목록 검증 실패 — 전체 페이지 재시도 (${attempt + 1}/2)`);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }
  throw lastError;
}

/**
 * 팝가 수집 잡 실행.
 * 웹 API 전체 목록의 계약을 검증한 뒤 기존 항목을 갱신하고 미등록 이벤트를 수집한다.
 */
export async function runPopgaCollector(): Promise<PopgaCollectorResult> {
  console.log(`[${JOB_NAME}] 시작 (MAX_NEW_EVENTS_PER_RUN=${MAX_NEW_EVENTS_PER_RUN})`);

  const items = await fetchValidatedEventList();
  console.log(`[${JOB_NAME}] 목록 총 ${items.length}건 확인`);

  const result = emptyResult(items.length);
  const failures: unknown[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const outcome = await processEvent(
        items[i],
        i,
        result.createdCount < MAX_NEW_EVENTS_PER_RUN,
      );
      if (outcome === 'created') {
        result.createdCount += 1;
        result.successCount += 1;
      } else if (outcome === 'existing') {
        result.refreshedCount += 1;
        result.successCount += 1;
      } else if (outcome === 'merged') {
        result.mergedCount += 1;
        result.successCount += 1;
      } else {
        result.deferredCount += 1;
        result.skippedCount += 1;
      }

      if ((outcome === 'created' || outcome === 'merged') && i < items.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    } catch (err: any) {
      result.failedCount += 1;
      failures.push(err);
      console.error(`[${JOB_NAME}] 처리 오류 (index=${i}): ${err?.message}`);
    }
  }

  console.log(
    `[${JOB_NAME}] 완료 — 등록 ${result.createdCount}, 기존 갱신 ${result.refreshedCount}, ` +
    `출처 병합 ${result.mergedCount}, 이월 ${result.deferredCount}, 실패 ${result.failedCount}`,
  );

  if (failures.length > 0) {
    const representative = (failures.find((failure: any) => {
      const status = Number(failure?.response?.status ?? failure?.status);
      const code = String(failure?.code ?? '');
      return status === 408 || status === 429 || status >= 500 ||
        ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code);
    }) ?? failures[0]) as any;
    const error = new Error(
      `팝가 ${result.itemsCount}건 중 ${result.failedCount}건 처리 실패 ` +
      `(등록 ${result.createdCount}, 갱신 ${result.refreshedCount}, 병합 ${result.mergedCount})`,
    );
    (error as any).jobStats = result;
    if (representative?.code) (error as any).code = representative.code;
    if (representative?.response?.status) {
      (error as any).response = { status: representative.response.status };
    } else if (representative?.status) {
      (error as any).status = representative.status;
    }
    throw error;
  }

  return result;
}
