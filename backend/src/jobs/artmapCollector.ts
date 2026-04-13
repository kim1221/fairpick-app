/**
 * artmapCollector — art-map.co.kr 전시 자동 수집 Job
 *
 * 동작:
 *  1. POST /data/new_exhibition.php → HTML 응답 파싱 (4건/요청)
 *  2. 중복(artmap ID / title / venue+날짜) 건너뜀
 *  3. 상세 페이지 HTML 파싱 → 주소/관람료/운영시간/설명 추출
 *  4. Gemini AI 정보 추출 → 이미지 R2 업로드 → DB 직접 삽입
 *
 * 스케줄: 매일 07:00 KST (scheduler.ts)
 * 수동 실행: Admin 운영센터 → "아트맵 수집" → 지금 실행
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { pool } from '../db';
import { uploadEventImage } from '../lib/imageUpload';
import { extractEventInfoEnhanced } from '../lib/aiExtractor';

// ─── 설정 ──────────────────────────────────────────────────────────────────

const MAX_PER_RUN = 500;

const ARTMAP_BASE = 'https://art-map.co.kr';
const LIST_API = `${ARTMAP_BASE}/data/new_exhibition.php`;
const JOB_NAME = 'artmap-collector';

const PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  Referer: `${ARTMAP_BASE}/exhibition/new_list.php`,
  'Content-Type': 'application/x-www-form-urlencoded',
};

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface ListItem {
  idx: string;
  title: string;
  venue: string;
  startAt: string | null;
  endAt: string | null;
  imageUrl: string | null;
  lat: number | null;
  lng: number | null;
}

interface DetailInfo {
  address: string | null;
  venueFromDetail: string | null;
  openingHours: string | null;
  closedDay: string | null;
  priceText: string | null;
  phone: string | null;
  websiteUrl: string | null;
  artist: string | null;
  description: string | null;
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // "2026.04.13" → "2026-04-13"
  const dot = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (dot) return `${dot[1]}-${dot[2]}-${dot[3]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  // "2026-04-10 - 2026-07-26" 형식
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

/** "서울 성북구 선잠로2나길 9" → "서울", "경기도 수원시 ..." → "경기" */
const ADDRESS_REGION_MAP: [string, string][] = [
  ['서울', '서울'], ['경기', '경기'], ['인천', '인천'],
  ['부산', '부산'], ['대구', '대구'], ['대전', '대전'],
  ['광주', '광주'], ['울산', '울산'], ['세종', '세종'],
  ['강원', '강원'], ['충북', '충북'], ['충남', '충남'],
  ['전북', '전북'], ['전남', '전남'], ['경북', '경북'],
  ['경남', '경남'], ['제주', '제주'],
];

function extractRegionFromAddress(address: string | null): string | null {
  if (!address) return null;
  for (const [prefix, region] of ADDRESS_REGION_MAP) {
    if (address.startsWith(prefix)) return region;
  }
  return null;
}

/** "소마미술관/서울" → venue="소마미술관", regionHint="서울" */
function splitVenueRegion(raw: string): { venue: string; regionHint: string | null } {
  const slash = raw.lastIndexOf('/');
  if (slash > 0) {
    return {
      venue: raw.substring(0, slash).trim(),
      regionHint: raw.substring(slash + 1).trim() || null,
    };
  }
  return { venue: raw.trim(), regionHint: null };
}

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15_000,
      headers: { ...PAGE_HEADERS, Accept: 'image/*,*/*;q=0.8' },
    });
    return Buffer.from(res.data);
  } catch (err: any) {
    console.warn(`[${JOB_NAME}] 이미지 다운로드 실패 (${url}): ${err?.message}`);
    return null;
  }
}

// ─── 중복 체크 ─────────────────────────────────────────────────────────────

async function isDuplicate(
  artmapIdx: string,
  title: string,
  venue: string,
  startAt: string,
  endAt: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM canonical_events
     WHERE (
       source_tags @> $1::jsonb
       OR title = $2
       OR (
         start_at::date = $4::date
         AND end_at::date = $5::date
         AND $3 != '' AND venue != ''
         AND (
           venue ILIKE $3
           OR venue ILIKE '%' || $3 || '%'
           OR $3 ILIKE '%' || venue || '%'
           OR (
             similarity(title, $2) > 0.6
             AND (
               venue ILIKE '%' || split_part($3, ' ', 1) || '%'
               OR $3 ILIKE '%' || split_part(venue, ' ', 1) || '%'
             )
           )
         )
       )
     )
     AND is_deleted = false LIMIT 1`,
    [JSON.stringify([`artmap:${artmapIdx}`]), title, venue, startAt, endAt],
  );
  return result.rowCount! > 0;
}

// ─── 목록 페이지 파싱 ──────────────────────────────────────────────────────

function parseListHtml(html: string): ListItem[] {
  const $ = cheerio.load(html);
  const items: ListItem[] = [];

  $('a[href*="view.php?idx="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const idxMatch = href.match(/idx=(\d+)/);
    if (!idxMatch) return;
    const idx = idxMatch[1];

    const spans = $(el).find('.new_exh_list span');
    const title = spans.eq(0).text().trim();
    const venueRaw = spans.eq(1).text().trim();
    const dateText = spans.eq(2).text().trim(); // "2026.04.13 ~ 2026.04.26"

    if (!title || !idx) return;

    // 날짜 파싱
    const dateMatch = dateText.match(
      /(\d{4}[.\-]\d{2}[.\-]\d{2})\s*~\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/,
    );
    const startAt = dateMatch ? normalizeDate(dateMatch[1]) : null;
    const endAt = dateMatch ? normalizeDate(dateMatch[2]) : null;

    // 이미지
    const imgSrc = $(el).find('img').attr('src') || null;
    const imageUrl =
      imgSrc && imgSrc.startsWith('http') ? imgSrc
      : imgSrc ? `${ARTMAP_BASE}${imgSrc.startsWith('/') ? '' : '/'}${imgSrc}`
      : null;

    // 위경도 (onclick에서 추출)
    // push_val("제목", lat, lng, idx, "장소", gallery_id, "image_url")
    const onclick = $(el).find('input[type="checkbox"]').attr('onclick') || '';
    const latLngMatch = onclick.match(/push_val\([^,]+,\s*([\d.-]+),\s*([\d.-]+)/);
    const lat = latLngMatch ? parseFloat(latLngMatch[1]) : null;
    const lng = latLngMatch ? parseFloat(latLngMatch[2]) : null;

    items.push({
      idx,
      title,
      venue: venueRaw,
      startAt,
      endAt,
      imageUrl,
      lat: lat && lat !== 0 ? lat : null,
      lng: lng && lng !== 0 ? lng : null,
    });
  });

  return items;
}

// ─── 목록 API (페이지네이션) ────────────────────────────────────────────────

/**
 * type별 목록을 페이지 단위로 스트리밍.
 * onPage 콜백이 false를 반환하면 조기 종료.
 */
async function streamByType(
  type: string,
  onPage: (items: ListItem[]) => Promise<boolean>,
): Promise<void> {
  let start = 0;
  let wrap = 1;

  while (true) {
    const body = new URLSearchParams({
      start: String(start),
      wrap: String(wrap),
      type,
      area: '0',
      cate: '',
      od: '0',
      v_cnt: '20',
      online: '0',
    });

    const res = await axios.post(LIST_API, body.toString(), {
      timeout: 15_000,
      headers: PAGE_HEADERS,
    });

    const items = parseListHtml(res.data);
    if (items.length === 0) break;

    const shouldContinue = await onPage(items);
    if (!shouldContinue) break;

    start += items.length;
    wrap++;
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ─── 상세 페이지 파싱 ──────────────────────────────────────────────────────

function parseDetailHtml(html: string): DetailInfo {
  const $ = cheerio.load(html);

  const fields: Record<string, string> = {};

  // 정보 테이블 파싱 (th → td)
  $('tr').each((_, row) => {
    const thText = $(row).find('th').text().replace(/\|/g, '').trim();
    const tdText = $(row).find('td').text().trim();
    if (thText && tdText) {
      fields[thText] = tdText;
    }
  });

  // 사이트 링크
  let websiteUrl: string | null = null;
  $('a').each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes('홈페이지') || text.includes('바로가기')) {
      const href = $(el).attr('href');
      if (href && href.startsWith('http')) {
        websiteUrl = href;
        return false; // break
      }
    }
  });

  // 설명 텍스트: <pre style="white-space:pre-line ...">
  let description: string | null = null;
  $('pre').each((_, el) => {
    const style = $(el).attr('style') || '';
    if (style.includes('white-space') || style.includes('pre-line')) {
      const text = $(el).text().trim();
      if (text.length > 30) {
        description = text;
        return false;
      }
    }
  });

  // 주소 끝 "/" 제거
  const rawAddress = fields['주소'] || null;
  const address = rawAddress ? rawAddress.replace(/\/+$/, '').trim() : null;

  // 작가 필드 공백 정리 (HTML 파싱 시 개행+들여쓰기 다수 포함)
  const rawArtist = fields['작가'] || null;
  const artist = rawArtist
    ? rawArtist
        .split(/[\n\r]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0)
        .join(', ')
    : null;

  return {
    address: address || null,
    venueFromDetail: fields['장소'] || null,
    openingHours: fields['시간'] || null,
    closedDay: fields['휴관일'] || fields['휴관'] || null,
    priceText: fields['관람료'] || null,
    phone: fields['전화번호'] || null,
    websiteUrl,
    artist,
    description,
  };
}

async function fetchDetail(idx: string): Promise<DetailInfo | null> {
  try {
    const res = await axios.get(`${ARTMAP_BASE}/exhibition/view.php?idx=${idx}`, {
      timeout: 15_000,
      headers: { ...PAGE_HEADERS, 'Content-Type': undefined },
    });
    return parseDetailHtml(res.data);
  } catch (err: any) {
    console.warn(`[${JOB_NAME}] 상세 페이지 실패 (idx=${idx}): ${err?.message}`);
    return null;
  }
}

// ─── 가격 파싱 ─────────────────────────────────────────────────────────────

function parsePriceFromText(text: string | null): {
  is_free: boolean | null;
  price_min: number | null;
  price_max: number | null;
  price_info: string | null;
} {
  if (!text) return { is_free: null, price_min: null, price_max: null, price_info: null };

  const lower = text.toLowerCase();
  if (lower.includes('무료') && !lower.includes('유료') && !lower.match(/\d+원/)) {
    return { is_free: true, price_min: 0, price_max: 0, price_info: '무료' };
  }

  const prices: number[] = [];
  const matches = text.matchAll(/(\d[\d,]+)\s*원/g);
  for (const m of matches) {
    const n = parseInt(m[1].replace(/,/g, ''));
    if (!isNaN(n) && n > 0 && n < 500_000) prices.push(n);
  }

  if (prices.length > 0) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return {
      is_free: false,
      price_min: min,
      price_max: max,
      price_info: text.length > 200 ? text.substring(0, 200) + '…' : text,
    };
  }

  return { is_free: null, price_min: null, price_max: null, price_info: text.length > 200 ? text.substring(0, 200) + '…' : text };
}

// ─── DB 직접 삽입 ──────────────────────────────────────────────────────────

interface InsertParams {
  title: string;
  startAt: string;
  endAt: string;
  venue: string;
  address: string | null;
  regionHint: string | null;
  imageUrl: string | null;
  imageStorage: string;
  imageOrigin: string | undefined;
  imageKey: string | null;
  overview: string | null;
  is_free: boolean | null;
  price_info: string | null;
  price_min: number | null;
  price_max: number | null;
  opening_hours: any;
  source_tags: string[];
  derived_tags: string[];
  external_links: Record<string, string>;
  lat: number | null;
  lng: number | null;
  metadata: any;
}

async function insertEventDirect(p: InsertParams): Promise<string | null> {
  const id = crypto.randomUUID();
  const contentKey = crypto
    .createHash('sha256')
    .update(`${p.title}-${p.startAt}-${p.endAt}-${p.venue}`)
    .digest('hex')
    .substring(0, 32);

  const [ey, em, ed] = p.endAt.split('-').map(Number);
  const endDate = new Date(ey, em - 1, ed);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilEnd = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const isEndingSoon = daysUntilEnd <= 7 && daysUntilEnd >= 0;

  let lat = p.lat;
  let lng = p.lng;
  let region: string | null = null;
  let geoSource: string | null = null;
  let geoConfidence: string | null = null;
  let geoReason: string | null = null;

  if (lat && lng) {
    // 목록에서 받은 좌표 사용
    geoSource = 'raw';
    geoConfidence = 'A';
    geoReason = 'lat/lng from artmap list API';
    // regionHint(venue "/지역") → 없으면 주소 앞글자에서 추출
    region = p.regionHint ?? extractRegionFromAddress(p.address) ?? null;
  } else if (p.address || p.venue) {
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

  const sourcesData = [{
    source: 'admin',
    createdBy: JOB_NAME,
    createdAt: new Date().toISOString(),
  }];

  const qualityFlags = {
    has_real_image: !!(p.imageUrl),
    has_exact_address: !!p.address,
    geo_ok: !!(lat && lng),
    has_overview: !!p.overview,
    has_price_info: !!p.price_info,
  };

  const result = await pool.query(
    `INSERT INTO canonical_events (
      id, content_key, title, display_title, start_at, end_at, venue, address,
      region, lat, lng, main_category, sub_category, image_url, is_free, price_info,
      overview, is_ending_soon, popularity_score, buzz_score, is_featured, featured_order,
      featured_at, sources, source_priority_winner, is_deleted, deleted_reason,
      image_storage, image_origin, image_source_page_url, image_key, image_metadata,
      geo_source, geo_confidence, geo_reason, geo_updated_at,
      external_links, status, price_min, price_max, source_tags, derived_tags,
      opening_hours, parking_available, parking_info, quality_flags,
      metadata, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24::jsonb,$25,$26,$27,
      $28,$29,$30,$31,$32::jsonb,
      $33,$34,$35,$36,
      $37::jsonb,$38,$39,$40,$41::jsonb,$42::jsonb,
      $43::jsonb,$44,$45,$46::jsonb,
      $47::jsonb, NOW(), NOW()
    ) RETURNING id`,
    [
      id, contentKey, p.title, null,
      p.startAt, p.endAt, p.venue, p.address || null,
      region, lat, lng,
      '전시', null,
      p.imageUrl || null,
      p.is_free, p.price_info,
      p.overview || null,
      isEndingSoon,
      500, 0, false, null, null,
      JSON.stringify(sourcesData),
      'manual', false, null,
      p.imageStorage || 'external',
      p.imageOrigin || null,
      null,
      p.imageKey || null,
      '{}',
      geoSource, geoConfidence, geoReason,
      geoSource ? new Date() : null,
      JSON.stringify(p.external_links || {}),
      'active',
      p.price_min ?? null, p.price_max ?? null,
      JSON.stringify(p.source_tags || []),
      JSON.stringify(p.derived_tags || []),
      p.opening_hours ? JSON.stringify(p.opening_hours) : null,
      null, null,
      JSON.stringify(qualityFlags),
      p.metadata ? JSON.stringify(p.metadata) : null,
    ],
  );

  return result.rows[0]?.id ?? null;
}

// ─── 단일 전시 처리 ────────────────────────────────────────────────────────

async function processExhibition(item: ListItem, index: number): Promise<boolean> {
  const { venue: venueRaw, idx } = item;
  const { venue, regionHint } = splitVenueRegion(venueRaw);

  const startAt =
    item.startAt ?? new Date().toISOString().substring(0, 10);
  const endAt =
    item.endAt ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  console.log(`[${JOB_NAME}] [${index + 1}] "${item.title}" (artmap:${idx})`);

  if (await isDuplicate(idx, item.title, venue, startAt, endAt)) {
    console.log(`[${JOB_NAME}]   → 중복 — 건너뜀`);
    return false;
  }

  // 상세 페이지
  const detail = await fetchDetail(idx);
  const address = detail?.address || null;
  // venueFromDetail도 "장소명/지역" 형식일 수 있으므로 splitVenueRegion 적용
  const venueFromDetailClean = detail?.venueFromDetail
    ? splitVenueRegion(detail.venueFromDetail).venue
    : null;
  const finalVenue = venueFromDetailClean || venue;
  const priceData = parsePriceFromText(detail?.priceText ?? null);

  // AI 검색 텍스트 구성
  const searchParts: string[] = [
    `전시명: ${item.title}`,
    `장소: ${finalVenue}`,
    regionHint ? `지역: ${regionHint}` : '',
    address ? `주소: ${address}` : '',
    `기간: ${startAt} ~ ${endAt}`,
    detail?.openingHours ? `관람시간: ${detail.openingHours}` : '',
    detail?.closedDay ? `휴관일: ${detail.closedDay}` : '',
    detail?.priceText ? `관람료: ${detail.priceText}` : '',
    detail?.artist ? `작가: ${detail.artist}` : '',
    detail?.description ? `전시 설명:\n${detail.description}` : '',
  ].filter(Boolean);

  const searchText = searchParts.join('\n');

  // Gemini AI 추출
  let aiInfo: any = null;
  try {
    aiInfo = await extractEventInfoEnhanced(
      item.title, '전시', null,
      String(new Date().getFullYear()),
      { ticket: [], official: [searchText], place: [], blog: [] },
    );
    console.log(`[${JOB_NAME}]   → AI 완료: tags=${JSON.stringify(aiInfo?.derived_tags ?? [])}`);
  } catch (err: any) {
    console.warn(`[${JOB_NAME}]   → Gemini 실패: ${err?.message}`);
  }

  // 이미지 R2 업로드
  let uploadedImageUrl: string | null = null;
  let uploadedImageKey: string | null = null;
  let imageStorage = 'external';
  if (item.imageUrl) {
    const buf = await downloadImage(item.imageUrl);
    if (buf && buf.length > 0) {
      try {
        const ext = item.imageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
        const result = await uploadEventImage(buf, `artmap_${idx}.${ext}`, { checkDuplicate: true });
        uploadedImageUrl = result.url;
        uploadedImageKey = result.key;
        imageStorage = 'cdn';
      } catch (err: any) {
        console.warn(`[${JOB_NAME}]   → R2 업로드 실패: ${err?.message}`);
        uploadedImageUrl = item.imageUrl;
      }
    } else {
      uploadedImageUrl = item.imageUrl;
    }
  }

  const sourceTags = ['artmap_collector', `artmap:${idx}`];

  // opening_hours 구성
  let openingHours: any = aiInfo?.opening_hours ?? null;
  if (!openingHours && detail?.openingHours) {
    const hoursText = detail.openingHours;
    openingHours = { description: hoursText };
    if (detail.closedDay) {
      openingHours.closed = detail.closedDay;
    }
  }

  const externalLinks: Record<string, string> = {
    artmap: `${ARTMAP_BASE}/exhibition/view.php?idx=${idx}`,
  };
  if (detail?.websiteUrl) externalLinks.official = detail.websiteUrl;

  try {
    const createdId = await insertEventDirect({
      title: item.title,
      startAt,
      endAt,
      venue: finalVenue,
      address,
      regionHint,
      imageUrl: uploadedImageUrl,
      imageStorage,
      imageOrigin: imageStorage === 'cdn' ? 'official_site' : undefined,
      imageKey: uploadedImageKey,
      overview: aiInfo?.overview_raw ?? aiInfo?.overview ?? detail?.description?.substring(0, 1000) ?? null,
      is_free: priceData.is_free ?? (aiInfo?.price_min === 0 ? true : null),
      price_info: priceData.price_info ?? (aiInfo?.price_min === 0 ? '무료' : null),
      price_min: priceData.price_min ?? aiInfo?.price_min ?? null,
      price_max: priceData.price_max ?? aiInfo?.price_max ?? null,
      opening_hours: openingHours,
      source_tags: sourceTags,
      derived_tags: aiInfo?.derived_tags ?? [],
      external_links: externalLinks,
      lat: item.lat,
      lng: item.lng,
      metadata: {
        artmap_idx: idx,
        region_hint: regionHint,
        phone: detail?.phone ?? null,
        source: JOB_NAME,
        // 프론트엔드/Admin이 읽는 표준 위치에 작가 정보 저장 (배열 형식)
        display: {
          exhibition: {
            ...(detail?.artist
              ? { artists: detail.artist.split(',').map((s: string) => s.trim()).filter(Boolean) }
              : {}),
            ...(aiInfo?.display?.exhibition ?? {}),
          },
        },
      },
    });

    if (!createdId) throw new Error('INSERT returned no id');
    console.log(`[${JOB_NAME}]   ✅ 등록 완료 — id: ${createdId}`);
    return true;
  } catch (err: any) {
    console.error(`[${JOB_NAME}]   ❌ DB 삽입 실패: ${err?.message}`);
    return false;
  }
}

// ─── 메인 export ───────────────────────────────────────────────────────────

// ing(현재 진행 중)은 134건 규모 — 전체 스캔해야 새로 ing된 전시를 놓치지 않음
// 등록 시점 기준 정렬이라 새로 ing된 전시가 앞쪽에 있다는 보장 없음
const EARLY_STOP_CONSECUTIVE = Infinity; // 조기 종료 사용 안 함

/**
 * 아트맵 전시 수집 잡 실행.
 * ing(현재전시) + ready(예정전시) 목록을 페이지 단위로 스트리밍하며 신규만 수집.
 * 연속 30건 중복 시 해당 type 조기 종료.
 * @returns 등록 성공 건수
 */
export async function runArtmapCollector(): Promise<number> {
  console.log(`[${JOB_NAME}] 시작 (MAX_PER_RUN=${MAX_PER_RUN}, EARLY_STOP=${EARLY_STOP_CONSECUTIVE})`);

  let created = 0;
  let totalScanned = 0;

  async function processType(type: string, label: string): Promise<void> {
    console.log(`[${JOB_NAME}] [${label}] 수집 시작`);
    let consecutiveDups = 0;
    let typeScanned = 0;

    await streamByType(type, async (pageItems) => {
      for (const item of pageItems) {
        if (created >= MAX_PER_RUN) return false;

        totalScanned++;
        typeScanned++;

        try {
          const ok = await processExhibition(item, totalScanned - 1);
          if (ok) {
            created++;
            consecutiveDups = 0; // 신규 발견 → 연속 중복 카운트 리셋
          } else {
            consecutiveDups++;
          }
        } catch (err: any) {
          console.error(`[${JOB_NAME}] 처리 오류: ${err?.message}`);
          consecutiveDups++;
        }

        if (consecutiveDups >= EARLY_STOP_CONSECUTIVE) {
          console.log(`[${JOB_NAME}] [${label}] 연속 중복 ${EARLY_STOP_CONSECUTIVE}건 — 조기 종료`);
          return false;
        }

        await new Promise((r) => setTimeout(r, 1500));
      }
      return true; // 다음 페이지 계속
    });

    console.log(`[${JOB_NAME}] [${label}] 완료 — 스캔 ${typeScanned}건, 등록 ${created}건`);
  }

  // ing(현재 진행 중)만 수집.
  // ready(예정)는 전시 시작되면 자동으로 ing으로 넘어오므로 그때 수집됨.
  await processType('ing', '현재전시');

  console.log(`[${JOB_NAME}] 완료 — 총 스캔 ${totalScanned}건, 등록 ${created}건`);
  return created;
}
