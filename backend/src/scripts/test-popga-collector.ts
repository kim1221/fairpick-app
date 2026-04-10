/**
 * test-popga-collector.ts
 *
 * 팝가(popga.co.kr) 이벤트 수집 파이프라인 테스트 스크립트
 *
 * 동작:
 *  1. popga.co.kr 목록 페이지에서 RSC 데이터 추출 → 이벤트 목록
 *  2. 최대 MAX_EVENTS개 순회
 *  3. 중복 체크 (source_tags @> '["popga:{id}"]')
 *  4. 상세 페이지 (/popup/{id}) 스크래핑 → content, instagram, benefits 추출
 *  5. Gemini extractEventInfo → overview, popup_display(브랜드/혼잡도/포토존 등), 주차, 태그
 *  6. 이미지 다운로드 → R2 업로드
 *  7. POST /admin/events/popup 으로 등록
 *  8. 마지막에 롤백 쿼리 출력
 *
 * 실행:
 *   cd backend
 *   ts-node -r dotenv/config src/scripts/test-popga-collector.ts
 *
 * 롤백:
 *   DELETE FROM canonical_events WHERE source_tags @> '["popga_collector_test"]'::jsonb;
 */

import axios from 'axios';
import { Pool } from 'pg';
import { uploadEventImage } from '../lib/imageUpload';
import { extractEventInfoEnhanced } from '../lib/aiExtractor';

// ─── 설정 ────────────────────────────────────────────────────────────────────

const MAX_EVENTS = parseInt(process.env.MAX_EVENTS || '3', 10);
const API_BASE = process.env.API_BASE_URL || 'http://localhost:5001';
const ADMIN_KEY = process.env.ADMIN_KEY || 'fairpick-admin-2024';

const POPGA_API_BASE = 'https://api.popga.co.kr/user';
const DETAIL_BASE = 'https://popga.co.kr';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? undefined : { rejectUnauthorized: false },
});

/** 팝가 API 요청 헤더 (Referer/Origin 필수) */
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://popga.co.kr/',
  Origin: 'https://popga.co.kr',
};

// (RSC 파싱 불필요 — REST API 직접 호출로 전환)

// ─── 유틸 ────────────────────────────────────────────────────────────────────

function toCategory(type: string | undefined): string {
  if (!type) return '팝업';
  return type.toUpperCase() === 'EXHIBITION' ? '전시' : '팝업';
}

function normalizeDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dot = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (dot) return `${dot[1]}-${dot[2]}-${dot[3]}`;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return raw.substring(0, 10);
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
      headers: { ...API_HEADERS, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    });
    return Buffer.from(res.data);
  } catch (err: any) {
    console.warn(`[popga] 이미지 다운로드 실패 (${url}): ${err?.message}`);
    return null;
  }
}

async function isDuplicate(popgaId: string | number, title: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM canonical_events
     WHERE (source_tags @> $1::jsonb OR title = $2)
       AND is_deleted = false LIMIT 1`,
    [JSON.stringify([`popga:${popgaId}`]), title],
  );
  return result.rowCount! > 0;
}

// ─── 목록 API (페이지네이션) ─────────────────────────────────────────────────

/**
 * 팝가 REST API에서 진행중/예정 이벤트 전체 목록을 가져온다.
 * GET https://api.popga.co.kr/user/v1/spots
 */
async function fetchEventList(): Promise<any[]> {
  const all: any[] = [];
  let page = 0;
  const size = 50;

  while (true) {
    const params = new URLSearchParams([
      ['periodTypes', 'IN_PROGRESS'],
      ['periodTypes', 'READY'],
      ['size', String(size)],
      ['page', String(page)],
      ['sorts[0].order', 'activated_at'],
    ]);

    console.log(`[popga] 목록 API page=${page + 1} 요청...`);
    const res = await axios.get(`${POPGA_API_BASE}/v1/spots?${params}`, {
      timeout: 15_000,
      headers: API_HEADERS,
    });

    // API 응답 구조: { data: { content: [...], page: { totalPages, totalElements, ... } } }
    const dataBlock = res.data?.data ?? res.data;
    const content: any[] = Array.isArray(dataBlock?.content) ? dataBlock.content : [];
    if (content.length === 0) break;

    all.push(...content);

    // Spring 3.x: pagination info는 data.page 하위에 있음
    const pageInfo = dataBlock?.page ?? {};
    const totalPages: number = pageInfo?.totalPages ?? dataBlock?.totalPages ?? 1;
    const totalElements: number = pageInfo?.totalElements ?? dataBlock?.totalElements ?? content.length;
    console.log(
      `[popga] page=${page + 1}/${totalPages} (${content.length}건) → 누계 ${all.length}/${totalElements}건`,
    );

    if (page + 1 >= totalPages || all.length >= 500) break;
    page++;
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[popga] 목록 총 ${all.length}건 수집 완료`);
  return all;
}

// ─── 상세 API ─────────────────────────────────────────────────────────────────

interface PopgaDetail {
  /** 상세 이벤트 오브젝트 전체 */
  obj: any;
  /** Gemini에 넘길 searchResults 텍스트 */
  searchText: string;
  /** instagram URL (website.instagram) */
  instagramUrl: string | null;
  /** AI 메이트 섹션 존재 여부 (주차·대기 정보 추출 가능 여부) */
  hasMate: boolean;
}

/**
 * 팝가 REST API에서 단건 상세 데이터를 가져온다.
 * GET https://api.popga.co.kr/user/v1/spots/{id}
 */
async function fetchDetail(popgaId: string | number): Promise<PopgaDetail | null> {
  let detail: any;
  try {
    const res = await axios.get(`${POPGA_API_BASE}/v1/spots/${popgaId}`, {
      timeout: 15_000,
      headers: API_HEADERS,
    });
    detail = res.data?.data ?? res.data;
    console.log(`  → 상세 API: id=${popgaId}, 키=${Object.keys(detail ?? {}).join(', ')}`);
    if (!detail?.id || !detail?.title) {
      console.warn(`  → 상세 응답 구조 이상`);
      return null;
    }
  } catch (err: any) {
    console.warn(`  → 상세 API 실패 (id=${popgaId}): ${err?.message}`);
    return null;
  }

  // Instagram URL
  const instagramUrl: string | null =
    detail.website?.instagram ?? detail.instagram ?? detail.sns?.instagram ?? null;

  // benefits 텍스트화
  const benefitLines: string[] = [];
  if (Array.isArray(detail.benefits)) {
    for (const b of detail.benefits) {
      if (b.key && b.value) benefitLines.push(`${b.key}: ${b.value}`);
      else if (b.value) benefitLines.push(b.value);
    }
  }

  // categories 텍스트화
  const categoryNames: string[] = Array.isArray(detail.categories)
    ? detail.categories.map((c: any) => c.name).filter(Boolean)
    : [];

  const parts: string[] = [];
  if (detail.title)                 parts.push(`이벤트명: ${detail.title}`);
  if (categoryNames.length > 0)     parts.push(`카테고리: ${categoryNames.join(', ')}`);
  if (detail.content)               parts.push(`설명:\n${detail.content}`);
  if (detail.address)               parts.push(`주소: ${detail.address}`);
  if (detail.addressDetail)         parts.push(`장소: ${detail.addressDetail}`);
  if (detail.openDate)              parts.push(`시작일: ${detail.openDate}`);
  if (detail.closeDate)             parts.push(`종료일: ${detail.closeDate}`);
  if (Array.isArray(detail.operationTime) && detail.operationTime.length > 0)
    parts.push(`운영시간: ${detail.operationTime.join(', ')}`);
  if (benefitLines.length > 0)      parts.push(`혜택:\n${benefitLines.join('\n')}`);
  if (detail.additionalInformation) parts.push(`추가정보: ${detail.additionalInformation}`);
  if (detail.notice)                parts.push(`공지: ${detail.notice}`);
  if (Array.isArray(detail.tags) && detail.tags.length > 0)
    parts.push(`태그: ${(detail.tags as string[]).join(', ')}`);
  if (instagramUrl)                 parts.push(`인스타그램: ${instagramUrl}`);

  // AI 메이트 섹션
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
    console.log(`  → AI 메이트 발견: ${mateText.substring(0, 100)}`);
  } else {
    console.log(`  → AI 메이트 없음 → 주차 정보 null`);
  }

  return { obj: detail, searchText: parts.join('\n'), instagramUrl, hasMate };
}

// ─── 단일 이벤트 처리 ─────────────────────────────────────────────────────────

async function processEvent(item: any, index: number): Promise<boolean> {
  const popgaId: string | number =
    item.id ?? item.eventId ?? item.popupId ?? item.seq ?? item._id ?? `unknown-${index}`;
  const type: string = item.type ?? item.category ?? item.eventType ?? 'STORE';
  const title: string =
    item.name ?? item.title ?? item.eventName ?? item.popupName ?? `팝업_${popgaId}`;

  console.log(`\n[${index + 1}/${MAX_EVENTS}] 처리 중: "${title}" (popga:${popgaId})`);

  if (await isDuplicate(popgaId, title)) {
    console.log(`  → 이미 등록됨 (popga:${popgaId} / title="${title}") — 건너뜀`);
    return false;
  }

  const category = toCategory(type);

  // 날짜
  const startAt =
    normalizeDate(item.openDate ?? item.startAt ?? item.startDate) ??
    new Date().toISOString().substring(0, 10);
  const endAt =
    normalizeDate(item.closeDate ?? item.endAt ?? item.endDate) ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  // 장소
  const venue: string = item.addressDetail ?? item.placeName ?? item.venue ?? '';
  const address: string = item.address ?? item.fullAddress ?? item.roadAddress ?? '';

  // 운영시간 (목록)
  const operationTimeRaw: string[] = Array.isArray(item.operationTime) ? item.operationTime : [];

  // 이미지
  const rawImagePath: string | undefined = item.file?.path ?? item.thumbnail ?? item.imageUrl;
  const popgaImageUrl = normalizeImageUrl(rawImagePath);

  // 팝가 원본 tags → source_tags에 포함
  const popgaTags: string[] = Array.isArray(item.tags) ? item.tags : [];

  console.log(`  category: ${category} | ${startAt} ~ ${endAt}`);
  console.log(`  venue: ${venue} / address: ${address}`);
  console.log(`  imageUrl: ${popgaImageUrl ?? '(없음)'}`);

  // ── 상세 API ──────────────────────────────────────────────────────────────
  const detail = await fetchDetail(popgaId);

  // 상세에서 가져온 보정값
  const detailVenue = detail?.obj?.addressDetail || venue;
  const detailAddress = detail?.obj?.address || address;
  const detailOperationTime: string[] =
    Array.isArray(detail?.obj?.operationTime) ? detail.obj.operationTime : operationTimeRaw;
  const detailTags: string[] = Array.isArray(detail?.obj?.tags) ? detail.obj.tags : popgaTags;
  const instagramUrl: string | null = detail?.instagramUrl ?? null;

  // ── searchResults 구성 ────────────────────────────────────────────────────
  const searchResults = [
    detail?.searchText || [
      `이벤트명: ${title}`,
      `카테고리: ${category}`,
      detailVenue ? `장소: ${detailVenue}` : '',
      detailAddress ? `주소: ${detailAddress}` : '',
      `기간: ${startAt} ~ ${endAt}`,
      detailOperationTime.length > 0 ? `운영시간: ${detailOperationTime.join(', ')}` : '',
      detailTags.length > 0 ? `태그: ${detailTags.join(', ')}` : '',
    ].filter(Boolean).join('\n'),
  ].join('');

  console.log(`  searchResults 앞 200자: ${searchResults.substring(0, 200)}`);

  // ── Gemini ────────────────────────────────────────────────────────────────
  console.log('  → Gemini 정보 추출 중...');
  let aiInfo: any = null;
  try {
    aiInfo = await extractEventInfoEnhanced(
      title,
      category,
      null,
      String(new Date().getFullYear()),
      {
        ticket: [],
        official: [searchResults],  // 팝가 상세 텍스트(AI 메이트 포함)를 official 섹션으로
        place: [],
        blog: [],
      },
      // address/venue 를 넘기지 않음 → Naver API 주차 검색 비활성화
    );

    // AI 메이트가 없는 팝업은 주차 정보를 강제로 null 처리
    if (aiInfo && !detail?.hasMate) {
      aiInfo.parking_available = undefined;
      aiInfo.parking_info = undefined;
    }

    console.log(`  → Gemini 완료: tags=${JSON.stringify(aiInfo?.derived_tags ?? [])}`);
    if (aiInfo?.popup_display) {
      const pd = aiInfo.popup_display;
      console.log(`  → popup_display: type=${pd.type}, brands=${JSON.stringify(pd.brands)}, photo=${pd.photo_zone}, waiting_hint=${JSON.stringify(pd.waiting_hint)}`);
    }
    console.log(`  → parking: available=${aiInfo?.parking_available ?? 'null'}, info=${aiInfo?.parking_info?.substring(0, 60) ?? 'null'}`);
  } catch (err: any) {
    console.warn(`  → Gemini 실패: ${err?.message}`);
  }

  // ── 이미지 R2 업로드 ─────────────────────────────────────────────────────
  let uploadedImageUrl: string | null = null;
  let uploadedImageKey: string | null = null;
  let imageStorage = 'external';

  if (popgaImageUrl) {
    console.log('  → 이미지 다운로드 중...');
    const buf = await downloadImage(popgaImageUrl);
    if (buf && buf.length > 0) {
      try {
        const ext = popgaImageUrl.split('?')[0].split('.').pop()?.toLowerCase() || 'jpg';
        const result = await uploadEventImage(buf, `popga_${popgaId}.${ext}`, { checkDuplicate: true });
        uploadedImageUrl = result.url;
        uploadedImageKey = result.key;
        imageStorage = 'cdn';
        console.log(`  → R2 업로드 완료: ${uploadedImageUrl}`);
      } catch (err: any) {
        console.warn(`  → R2 업로드 실패: ${err?.message}`);
        uploadedImageUrl = popgaImageUrl;
      }
    } else {
      uploadedImageUrl = popgaImageUrl;
    }
  }

  // ── source_tags: 팝가 원본 tags + 시스템 태그 ──────────────────────────────
  const sourceTags = [
    ...detailTags.filter(t => t && t.trim()),
    'popga_collector_test',
    `popga:${popgaId}`,
  ];

  // ── metadata 구성 — popup_display 는 metadata.display.popup 에 저장 ────────
  const popupDisplay = aiInfo?.popup_display ?? null;
  const metadataPayload = {
    display: popupDisplay
      ? { popup: popupDisplay }
      : undefined,
    popga_id: String(popgaId),
    popga_type: type,
    source: 'popga_collector_test',
  };

  // ── POST /admin/events/popup — camelCase 필드 ────────────────────────────
  const payload: Record<string, any> = {
    title,
    startAt,
    endAt,
    venue: detailVenue || title,
    address: detailAddress || null,
    imageUrl: uploadedImageUrl,
    imageStorage,
    imageOrigin: imageStorage === 'cdn' ? 'official_site' : undefined,
    imageKey: uploadedImageKey,
    overview: aiInfo?.overview_raw ?? aiInfo?.overview ?? null,
    instagramUrl,
    // 팝업 카테고리는 가격 정보를 표시하지 않음 (입장 무료이지만 굿즈 구매가 주목적)
    is_free: category === '팝업' ? null : (aiInfo?.price_min === 0 ? true : null),
    price_info: category === '팝업' ? null : (
      aiInfo?.price_min === 0
        ? '무료'
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
    metadata: metadataPayload,
  };

  console.log('  → POST /admin/events/popup 전송 중...');
  try {
    const apiRes = await axios.post(`${API_BASE}/admin/events/popup`, payload, {
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
      timeout: 30_000,
    });

    // popup 엔드포인트는 { item: { id, ... } } 응답
    const createdId: string = apiRes.data?.item?.id ?? apiRes.data?.id ?? '(unknown)';
    console.log(`  ✅ 등록 성공 — canonical_events.id: ${createdId}`);
    return true;
  } catch (err: any) {
    const status = err?.response?.status;
    const code = err?.code;
    const msg = err?.message;
    const data = err?.response?.data;
    console.error(`  ❌ 등록 실패: HTTP=${status}, code=${code}, msg=${msg}`);
    if (data !== undefined) console.error(`     서버 응답:`, JSON.stringify(data).substring(0, 400));
    return false;
  }
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== test-popga-collector 시작 ===');
  console.log(`API_BASE: ${API_BASE} | MAX_EVENTS: ${MAX_EVENTS}`);

  // 서버 연결 확인
  try {
    await axios.get(`${API_BASE}/health`, { timeout: 3_000 });
    console.log(`[popga] ✅ API 서버 연결 확인`);
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED') {
      console.error(`[popga] ❌ API 서버 미실행 (${API_BASE}) → npm run dev 먼저 실행`);
      process.exit(1);
    }
    if (err?.response?.status) console.log(`[popga] ✅ API 서버 연결 확인 (${err.response.status})`);
  }

  // MAX_EVENTS: 안전 상한선 (한 번에 너무 많이 처리하지 않도록)
  const MAX_PER_RUN = MAX_EVENTS;
  let processed = 0, created = 0, skipped = 0;

  try {
    const items = await fetchEventList();
    console.log(`\n[popga] 전체 ${items.length}건 — 중복 발견 시 즉시 종료 (상한: ${MAX_PER_RUN})`);

    for (let i = 0; i < items.length; i++) {
      if (created >= MAX_PER_RUN) {
        console.log(`[popga] 상한 ${MAX_PER_RUN}건 도달 — 종료`);
        break;
      }
      processed++;
      try {
        const ok = await processEvent(items[i], i);
        ok ? created++ : skipped++;
      } catch (err: any) {
        console.error(`[popga] 처리 오류 (index=${i}): ${err?.message}`);
        skipped++;
      }
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 1500));
    }
  } catch (err: any) {
    console.error('[popga] 치명적 오류:', err?.message);
  } finally {
    await pool.end();
  }

  console.log(`\n=== 결과: 처리 ${processed} | 등록 ${created} | 건너뜀 ${skipped} ===`);
  console.log('\n[롤백 쿼리]');
  console.log(`DELETE FROM canonical_events WHERE source_tags @> '["popga_collector_test"]'::jsonb;`);
  console.log(`SELECT id, title, source_tags FROM canonical_events WHERE source_tags @> '["popga_collector_test"]'::jsonb;`);
}

main()
  .then(() => { console.log('\n[popga] 완료'); process.exit(0); })
  .catch(err => { console.error('[popga] 실패:', err); process.exit(1); });
