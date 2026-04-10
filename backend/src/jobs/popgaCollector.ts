/**
 * popgaCollector — 팝가(popga.co.kr) 이벤트 자동 수집 Job
 *
 * 동작:
 *  1. popga REST API (api.popga.co.kr) → 전체 진행중·예정 이벤트 목록 (페이지네이션)
 *  2. 위에서부터 순회하며 중복(popga ID 또는 title) 건너뜀
 *  3. 상세 API 호출 → Gemini AI 정보 추출
 *  4. 이미지 R2 업로드 → POST /admin/events/popup 등록
 *
 * 스케줄: 매일 06:00 KST (scheduler.ts)
 * 수동 실행: Admin 운영센터 → "팝가 수집" → 지금 실행
 */

import axios from 'axios';
import { pool } from '../db';
import { uploadEventImage } from '../lib/imageUpload';
import { extractEventInfoEnhanced } from '../lib/aiExtractor';

// ─── 설정 ──────────────────────────────────────────────────────────────────

const MAX_PER_RUN = 50;
const API_BASE = process.env.API_BASE_URL || 'http://localhost:5001';
const ADMIN_KEY = process.env.ADMIN_KEY || 'fairpick-admin-2024';

const POPGA_API_BASE = 'https://api.popga.co.kr/user';
const DETAIL_BASE = 'https://popga.co.kr';
const JOB_NAME = 'popga-collector';

/** 팝가 API 요청 헤더 (Referer/Origin 필수) */
const API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://popga.co.kr/',
  Origin: 'https://popga.co.kr',
};

// ─── 유틸 ──────────────────────────────────────────────────────────────────

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
      headers: {
        ...API_HEADERS,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    return Buffer.from(res.data);
  } catch (err: any) {
    console.warn(`[${JOB_NAME}] 이미지 다운로드 실패 (${url}): ${err?.message}`);
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

// ─── 목록 API (페이지네이션) ────────────────────────────────────────────────

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
    console.log(
      `[${JOB_NAME}] 목록 page=${page + 1}/${totalPages}, 이번 ${content.length}건 (누계 ${all.length}건)`,
    );

    if (page + 1 >= totalPages || all.length >= 500) break;
    page++;
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
}

// ─── 상세 API ──────────────────────────────────────────────────────────────

interface PopgaDetail {
  obj: any;
  searchText: string;
  instagramUrl: string | null;
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
    if (!detail?.id || !detail?.title) return null;
  } catch (err: any) {
    console.warn(`[${JOB_NAME}] 상세 API 실패 (id=${popgaId}): ${err?.message}`);
    return null;
  }

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

// ─── 단일 이벤트 처리 ──────────────────────────────────────────────────────

async function processEvent(item: any, index: number): Promise<boolean> {
  const popgaId: string | number =
    item.id ?? item.eventId ?? item.popupId ?? item.seq ?? item._id ?? `unknown-${index}`;
  const type: string = item.type ?? item.category ?? item.eventType ?? 'STORE';
  const title: string =
    item.name ?? item.title ?? item.eventName ?? item.popupName ?? `팝업_${popgaId}`;

  console.log(`[${JOB_NAME}] [${index + 1}] "${title}" (popga:${popgaId})`);

  if (await isDuplicate(popgaId, title)) {
    console.log(`[${JOB_NAME}]   → 중복 — 건너뜀`);
    return false;
  }

  const category = toCategory(type);
  const startAt =
    normalizeDate(item.openDate ?? item.startAt ?? item.startDate) ??
    new Date().toISOString().substring(0, 10);
  const endAt =
    normalizeDate(item.closeDate ?? item.endAt ?? item.endDate) ??
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

  const venue: string = item.addressDetail ?? item.placeName ?? item.venue ?? '';
  const address: string = item.address ?? item.fullAddress ?? item.roadAddress ?? '';
  const operationTimeRaw: string[] = Array.isArray(item.operationTime) ? item.operationTime : [];
  const rawImagePath: string | undefined = item.file?.path ?? item.thumbnail ?? item.imageUrl;
  const popgaImageUrl = normalizeImageUrl(rawImagePath);
  const popgaTags: string[] = Array.isArray(item.tags) ? item.tags : [];

  // 상세 API
  const detail = await fetchDetail(popgaId);
  const detailVenue = detail?.obj?.addressDetail || venue;
  const detailAddress = detail?.obj?.address || address;
  const detailOperationTime: string[] =
    Array.isArray(detail?.obj?.operationTime) ? detail.obj.operationTime : operationTimeRaw;
  const detailTags: string[] = Array.isArray(detail?.obj?.tags) ? detail.obj.tags : popgaTags;
  const instagramUrl: string | null = detail?.instagramUrl ?? null;

  const searchResults = detail?.searchText || [
    `이벤트명: ${title}`,
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
      title, category, null,
      String(new Date().getFullYear()),
      { ticket: [], official: [searchResults], place: [], blog: [] },
    );
    if (aiInfo && !detail?.hasMate) {
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
      source: 'popga_collector',
    },
  };

  try {
    const apiRes = await axios.post(`${API_BASE}/admin/events/popup`, payload, {
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
      timeout: 30_000,
    });
    const createdId: string = apiRes.data?.item?.id ?? apiRes.data?.id ?? '(unknown)';
    console.log(`[${JOB_NAME}]   ✅ 등록 완료 — id: ${createdId}`);
    return true;
  } catch (err: any) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.error(`[${JOB_NAME}]   ❌ 등록 실패 HTTP=${status}:`, JSON.stringify(data)?.substring(0, 200));
    return false;
  }
}

// ─── 메인 export ───────────────────────────────────────────────────────────

/**
 * 팝가 수집 잡 실행.
 * REST API로 전체 목록을 가져온 뒤 미등록 이벤트만 수집 (최대 MAX_PER_RUN건).
 * @returns 등록 성공 건수
 */
export async function runPopgaCollector(): Promise<number> {
  console.log(`[${JOB_NAME}] 시작 (MAX_PER_RUN=${MAX_PER_RUN})`);

  const items = await fetchEventList();
  console.log(`[${JOB_NAME}] 목록 총 ${items.length}건 확인`);

  let created = 0;

  for (let i = 0; i < items.length; i++) {
    if (created >= MAX_PER_RUN) {
      console.log(`[${JOB_NAME}] 상한 ${MAX_PER_RUN}건 도달 — 종료`);
      break;
    }
    try {
      const ok = await processEvent(items[i], i);
      if (ok) created++;
    } catch (err: any) {
      console.error(`[${JOB_NAME}] 처리 오류 (index=${i}): ${err?.message}`);
    }
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`[${JOB_NAME}] 완료 — 등록 ${created}건`);
  return created;
}
