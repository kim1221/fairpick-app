/**
 * popgaCollector — 팝가(popga.co.kr) 이벤트 자동 수집 Job
 *
 * 동작:
 *  1. popga.co.kr 목록 페이지 RSC 파싱 → 최신순 이벤트 목록
 *  2. 위에서부터 순회하며 중복(popga ID 또는 title) 발견 시 즉시 종료
 *  3. 미수집 이벤트 상세 페이지 파싱 + Gemini AI 정보 추출
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

const LIST_URL = 'https://popga.co.kr/list/popup';
const DETAIL_BASE = 'https://popga.co.kr';
const JOB_NAME = 'popga-collector';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

// ─── RSC 파싱 ──────────────────────────────────────────────────────────────

function walkRscQueries<T>(html: string, visitor: (data: any) => T | null): T | null {
  const scriptTagRe = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let sm: RegExpExecArray | null;
  while ((sm = scriptTagRe.exec(html)) !== null) {
    const raw = sm[1];
    if (!raw.includes('__next_f')) continue;
    const pushMatch = raw.match(/self\.__next_f\.push\((\[[\s\S]*\])\)/);
    if (!pushMatch) continue;
    let arr: any;
    try { arr = JSON.parse(pushMatch[1]); } catch { continue; }
    if (!Array.isArray(arr) || arr[0] !== 1 || typeof arr[1] !== 'string') continue;
    const rscStr: string = arr[1];
    const colonIdx = rscStr.indexOf(':');
    if (colonIdx < 0) continue;
    let parsed: any;
    try { parsed = JSON.parse(rscStr.slice(colonIdx + 1)); } catch { continue; }
    if (!Array.isArray(parsed) || parsed.length < 4) continue;
    const sw = parsed[3];
    if (!sw?.state?.queries) continue;
    for (const query of sw.state.queries) {
      const result = visitor(query?.state?.data);
      if (result !== null) return result;
    }
  }
  return null;
}

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
      headers: { ...BROWSER_HEADERS, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
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

// ─── 목록 페이지 파싱 ──────────────────────────────────────────────────────

async function fetchEventList(): Promise<any[]> {
  const res = await axios.get(LIST_URL, { timeout: 15_000, headers: BROWSER_HEADERS });
  const html = res.data as string;
  const items = walkRscQueries<any[]>(html, (data) => {
    if (!Array.isArray(data?.pages)) return null;
    const all: any[] = [];
    for (const page of data.pages) {
      const content = page?.data?.content;
      if (Array.isArray(content)) all.push(...content);
    }
    return all.length > 0 ? all : null;
  });
  if (!items) throw new Error('popga 이벤트 목록을 HTML에서 찾지 못했습니다');
  return items;
}

// ─── 상세 페이지 파싱 ──────────────────────────────────────────────────────

interface PopgaDetail {
  obj: any;
  searchText: string;
  instagramUrl: string | null;
  hasMate: boolean;
}

async function fetchDetail(popgaId: string | number, type: string): Promise<PopgaDetail | null> {
  const segment = type.toUpperCase() === 'EXHIBITION' ? 'exhibition' : 'popup';
  const url = `${DETAIL_BASE}/${segment}/${popgaId}`;
  let html: string;
  try {
    const res = await axios.get(url, { timeout: 15_000, headers: BROWSER_HEADERS });
    html = res.data as string;
  } catch (err: any) {
    console.warn(`[${JOB_NAME}] 상세 페이지 실패 (${url}): ${err?.message}`);
    return null;
  }

  const detail = walkRscQueries<any>(html, (data) => {
    if (data?.data?.id && data?.data?.title) return data.data;
    if (data?.id && data?.title) return data;
    return null;
  });

  if (!detail) return null;

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

  // 상세 페이지
  const detail = await fetchDetail(popgaId, type);
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
    // AI 메이트 없으면 주차 null
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
    ...detailTags.filter(t => t && t.trim()),
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
 * 목록 전체를 순회하며 미등록 이벤트만 수집 (최대 MAX_PER_RUN건).
 * @returns 등록 성공 건수
 */
export async function runPopgaCollector(): Promise<number> {
  console.log(`[${JOB_NAME}] 시작 (MAX_PER_RUN=${MAX_PER_RUN})`);

  const items = await fetchEventList();
  console.log(`[${JOB_NAME}] 목록 ${items.length}건 전체 순회`);

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
    if (i < items.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`[${JOB_NAME}] 완료 — 등록 ${created}건`);
  return created;
}
