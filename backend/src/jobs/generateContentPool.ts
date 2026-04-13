/**
 * 매거진 피드 콘텐츠 풀 생성 잡
 *
 * 매일 05:30 KST에 실행되어 content_pool 테이블을 갱신합니다.
 * - TREND (5개): SQL 집계만, Gemini 없음
 * - BUNDLE (5개): Gemini 소개문 생성 (RAG)
 * - SPOTLIGHT (2개): Gemini 소개문 생성 (단일 이벤트)
 *
 * 최소 노출 기준: 이벤트 5개 미만이면 해당 테마 당일 생성 건너뜀
 */

import { pool } from '../db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logAiUsage } from '../lib/aiUsageLogger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro';
const MIN_EVENTS = 5; // 테마 최소 이벤트 수

interface EventRow {
  id: string;
  title: string;
  overview: string | null;
  main_category: string;
  sub_category: string | null;
  region: string | null;
  price_min: number | null;
  is_free: boolean | null;
  buzz_score: number;
  end_at: string;
  venue: string | null;
}

interface ContentCard {
  content_type: 'TREND' | 'BUNDLE' | 'SPOTLIGHT';
  framing_type: string;
  title: string;
  body: string | null;
  event_ids: string[];
  target_region: string | null;
  priority: number;
  metadata: Record<string, unknown>;
}

// ─── Gemini 클라이언트 초기화 ─────────────────────────────────

let geminiModel: any = null;
if (GEMINI_API_KEY) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 300,
      topP: 0.9,
    },
  });
}

// ─── Gemini 소개문 생성 (RAG) ──────────────────────────────────

async function generateBundleBody(
  themeTitle: string,
  events: EventRow[],
): Promise<string | null> {
  if (!geminiModel) return null;

  // RAG: 이벤트 실데이터만 프롬프트에 주입 (할루시네이션 방지)
  const eventSnippets = events
    .slice(0, 5)
    .map((e, i) => {
      const price = e.is_free ? '무료' : e.price_min ? `${e.price_min.toLocaleString()}원~` : '가격 미정';
      const overview = e.overview ? e.overview.slice(0, 120) : '';
      return `${i + 1}. [${e.main_category}] ${e.title} (${e.region ?? ''} | ${price})${overview ? '\n   ' + overview : ''}`;
    })
    .join('\n');

  const prompt = `당신은 문화생활 매거진 에디터입니다. 아래 이벤트 목록을 기반으로 "${themeTitle}" 테마의 짧은 소개 문구를 작성해주세요.

[조건]
- 80~120자 이내로 간결하게
- 아래 제공된 이벤트 데이터에만 근거하여 작성 (없는 정보 추가 금지)
- 반말/명령체 금지, 자연스러운 권유 어조
- 이모지 사용 금지

[이벤트 목록]
${eventSnippets}

소개 문구:`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    logAiUsage({
      model: GEMINI_MODEL,
      usageType: 'curation_copy',
      promptTokens: Math.ceil(prompt.length / 4),
      responseTokens: Math.ceil(text.length / 4),
    });
    return text;
  } catch (err: any) {
    console.error(`[ContentPool] Gemini 생성 실패 (${themeTitle}):`, err?.message);
    return null;
  }
}

// ─── 요일 기반 우선순위 계산 ─────────────────────────────────

function getDayBasedPriority(framingType: string): number {
  const day = new Date().getDay(); // 0=일, 1=월, ..., 6=토

  // 목/금(4,5): 주말 축제 테마 상위로
  if ((day === 4 || day === 5) && framingType === 'weekend_festival') return 10;

  // 월/화(1,2): 새로 열린 것들 상위로
  if ((day === 1 || day === 2) && framingType === 'newly_opened') return 10;

  return 0;
}

// ─── TREND 카드 생성 ─────────────────────────────────────────

async function buildTrendCards(): Promise<ContentCard[]> {
  const cards: ContentCard[] = [];
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // 1. 이번 주 뜨는 팝업 (서울 + 경기 상위 지역)
  const popupResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND main_category = '팝업'
      AND buzz_score > 0
      AND image_url IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (popupResult.rows.length >= MIN_EVENTS) {
    cards.push({
      content_type: 'TREND',
      framing_type: 'trending_popup',
      title: '이번 주 뜨는 팝업',
      body: null,
      event_ids: popupResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('trending_popup'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 2. 요즘 가장 화제인 전시
  const exhibitionResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND main_category = '전시'
      AND buzz_score > 0
      AND image_url IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (exhibitionResult.rows.length >= MIN_EVENTS) {
    cards.push({
      content_type: 'TREND',
      framing_type: 'trending_exhibition',
      title: '요즘 가장 화제인 전시',
      body: null,
      event_ids: exhibitionResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('trending_exhibition'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 3. 지금 가장 많이 찾는 공연
  const performanceResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND main_category = '공연'
      AND buzz_score > 0
      AND image_url IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (performanceResult.rows.length >= MIN_EVENTS) {
    cards.push({
      content_type: 'TREND',
      framing_type: 'trending_performance',
      title: '지금 가장 많이 찾는 공연',
      body: null,
      event_ids: performanceResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('trending_performance'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 4. 이번 주말 축제
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  const fridayDate = new Date(today);
  fridayDate.setDate(today.getDate() + daysUntilFriday);
  const sundayDate = new Date(fridayDate);
  sundayDate.setDate(fridayDate.getDate() + 2);

  const festivalResult = await pool.query<EventRow>(
    `
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND start_at <= $2
      AND end_at >= $1
      AND main_category IN ('축제', '행사')
      AND image_url IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `,
    [fridayDate.toISOString().slice(0, 10), sundayDate.toISOString().slice(0, 10)],
  );

  if (festivalResult.rows.length >= MIN_EVENTS) {
    cards.push({
      content_type: 'TREND',
      framing_type: 'weekend_festival',
      title: '이번 주말 축제 뭐 있어?',
      body: null,
      event_ids: festivalResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('weekend_festival'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 5. 무료인데 핫한 것들
  const freeResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND (is_free = true OR price_min = 0)
      AND buzz_score > 0
      AND image_url IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (freeResult.rows.length >= MIN_EVENTS) {
    cards.push({
      content_type: 'TREND',
      framing_type: 'free_hot',
      title: '무료인데 핫한 것들',
      body: null,
      event_ids: freeResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('free_hot'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  return cards;
}

// ─── BUNDLE 카드 생성 ─────────────────────────────────────────

async function buildBundleCards(): Promise<ContentCard[]> {
  const cards: ContentCard[] = [];

  // 1. 1만원으로 즐기는 문화생활
  const priceResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND main_category != '팝업'
      AND (is_free = true OR price_min = 0 OR price_min <= 10000)
      AND image_url IS NOT NULL
      AND overview IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (priceResult.rows.length >= MIN_EVENTS) {
    const body = await generateBundleBody('1만원으로 즐기는 문화생활', priceResult.rows);
    cards.push({
      content_type: 'BUNDLE',
      framing_type: 'price_under_10k',
      title: '1만원으로 즐기는 문화생활',
      body,
      event_ids: priceResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('price_under_10k'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 2. 이번 주가 마지막인 것들
  const endingResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND end_at <= CURRENT_DATE + INTERVAL '7 days'
      AND buzz_score > 0
      AND image_url IS NOT NULL
      AND overview IS NOT NULL
    ORDER BY end_at ASC, buzz_score DESC
    LIMIT 8
  `);

  if (endingResult.rows.length >= MIN_EVENTS) {
    const body = await generateBundleBody('이번 주가 마지막인 것들', endingResult.rows);
    cards.push({
      content_type: 'BUNDLE',
      framing_type: 'ending_soon_bundle',
      title: '이번 주가 마지막인 것들',
      body,
      event_ids: endingResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('ending_soon_bundle') + 2, // 긴박감 가산
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 3. 이번 달 새로 열린 것들
  const newlyResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND first_collected_at >= NOW() - INTERVAL '14 days'
      AND image_url IS NOT NULL
      AND overview IS NOT NULL
    ORDER BY first_collected_at DESC
    LIMIT 8
  `);

  if (newlyResult.rows.length >= MIN_EVENTS) {
    const body = await generateBundleBody('이번 달 새로 열린 것들', newlyResult.rows);
    cards.push({
      content_type: 'BUNDLE',
      framing_type: 'newly_opened',
      title: '이번 달 새로 열린 것들',
      body,
      event_ids: newlyResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('newly_opened'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 4. 지하철역 5분 거리
  const metroResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND (metadata->'internal'->'location'->>'walking_distance')::int <= 500
      AND image_url IS NOT NULL
      AND overview IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (metroResult.rows.length >= MIN_EVENTS) {
    const body = await generateBundleBody('지하철역 5분 거리', metroResult.rows);
    cards.push({
      content_type: 'BUNDLE',
      framing_type: 'metro_5min',
      title: '지하철역 5분 거리',
      body,
      event_ids: metroResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('metro_5min'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 5. 실내에서 즐기는 나들이
  const indoorResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND (metadata->'internal'->'matching'->>'indoor')::boolean = true
      AND image_url IS NOT NULL
      AND overview IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 8
  `);

  if (indoorResult.rows.length >= MIN_EVENTS) {
    const body = await generateBundleBody('실내에서 즐기는 나들이', indoorResult.rows);
    cards.push({
      content_type: 'BUNDLE',
      framing_type: 'indoor_picks',
      title: '실내에서 즐기는 나들이',
      body,
      event_ids: indoorResult.rows.map((r) => r.id),
      target_region: null,
      priority: getDayBasedPriority('indoor_picks'),
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  return cards;
}

// ─── SPOTLIGHT 카드 생성 ──────────────────────────────────────

async function buildSpotlightCards(): Promise<ContentCard[]> {
  const cards: ContentCard[] = [];

  // 1. 이달의 추천 공연 (KOPIS 데이터 풍부 + buzz 상위)
  const perfResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND main_category = '공연'
      AND buzz_score > 0
      AND image_url IS NOT NULL
      AND overview IS NOT NULL
      AND metadata->'display'->'performance' IS NOT NULL
    ORDER BY buzz_score DESC
    LIMIT 1
  `);

  if (perfResult.rows.length > 0) {
    const event = perfResult.rows[0]!;
    const body = await generateBundleBody(`이달의 추천 공연: ${event.title}`, [event]);
    cards.push({
      content_type: 'SPOTLIGHT',
      framing_type: 'monthly_performance',
      title: '이달의 추천 공연',
      body,
      event_ids: [event.id],
      target_region: null,
      priority: 5,
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  // 2. 에디터 픽 (is_featured + overview 있음)
  const editorResult = await pool.query<EventRow>(`
    SELECT id, title, overview, main_category, sub_category, region,
           price_min, is_free, buzz_score, end_at, venue
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND end_at >= CURRENT_DATE
      AND is_featured = true
      AND overview IS NOT NULL
      AND image_url IS NOT NULL
    ORDER BY featured_score DESC, buzz_score DESC
    LIMIT 1
  `);

  if (editorResult.rows.length > 0) {
    const event = editorResult.rows[0]!;
    const body = await generateBundleBody(`에디터가 추천하는 ${event.main_category}: ${event.title}`, [event]);
    cards.push({
      content_type: 'SPOTLIGHT',
      framing_type: 'editor_pick',
      title: '에디터 픽',
      body,
      event_ids: [event.id],
      target_region: null,
      priority: 8,
      metadata: { generated_at: new Date().toISOString() },
    });
  }

  return cards;
}

// ─── 메인 실행 함수 ───────────────────────────────────────────

export async function generateContentPool(): Promise<void> {
  console.log('[ContentPool] 콘텐츠 풀 생성 시작');
  const startTime = Date.now();

  // 1. 만료된 카드 삭제
  const deleteResult = await pool.query(
    `DELETE FROM content_pool WHERE expires_at < NOW()`,
  );
  console.log(`[ContentPool] 만료 카드 삭제: ${deleteResult.rowCount}개`);

  // 2. 오늘 이미 생성된 framing_type 목록 확인 (중복 생성 방지)
  const existingResult = await pool.query<{ framing_type: string }>(
    `SELECT framing_type FROM content_pool
     WHERE generated_at >= CURRENT_DATE AT TIME ZONE 'Asia/Seoul'`,
  );
  const existingFramingTypes = new Set(existingResult.rows.map((r) => r.framing_type));

  // 3. 카드 생성
  const [trendCards, bundleCards, spotlightCards] = await Promise.all([
    buildTrendCards(),
    buildBundleCards(),
    buildSpotlightCards(),
  ]);

  const allCards = [...trendCards, ...bundleCards, ...spotlightCards];

  // 4. DB 저장 (오늘 이미 생성된 framing_type 제외)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 1);
  expiresAt.setHours(6, 0, 0, 0); // 다음 날 06:00 KST 만료

  let insertedCount = 0;
  let skippedCount = 0;

  for (const card of allCards) {
    if (existingFramingTypes.has(card.framing_type)) {
      skippedCount++;
      continue;
    }

    await pool.query(
      `INSERT INTO content_pool
         (content_type, framing_type, title, body, event_ids, target_region, priority, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5::uuid[], $6, $7, $8, $9)`,
      [
        card.content_type,
        card.framing_type,
        card.title,
        card.body,
        card.event_ids,
        card.target_region,
        card.priority,
        expiresAt.toISOString(),
        JSON.stringify(card.metadata),
      ],
    );
    insertedCount++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[ContentPool] 완료 — 생성: ${insertedCount}개, 건너뜀(이미 존재): ${skippedCount}개, 소요: ${elapsed}s`,
  );
}
