/**
 * AI 핫 이벤트 평가 (Grounding 사용)
 * 
 * **핵심:**
 * - 공공 API로 이미 수집된 전시/공연/축제 중
 * - AI가 "지금 가장 핫한 것" 선별
 * - buzz_components.ai_hotness에 점수 저장
 * 
 * **비용:** ~$0.015/월
 * **실행:** 매주 월요일 09:00 KST
 */

import { pool } from '../db';
import { logAiUsage } from '../lib/aiUsageLogger';
import * as dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();


interface HotRating {
  index: number;
  hotness_score: number;
  reason: string;
}

/**
 * Gemini API 호출 (Grounding 사용)
 */
async function callGeminiWithGrounding(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000); // 60초 타임아웃

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: prompt }]
          }],
          tools: [{
            google_search: {}
          }],
          generationConfig: {
            temperature: 0.3,
            thinkingConfig: { thinkingBudget: 0 },
          }
        })
      }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json() as any;
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  // AI 사용량 로깅 (grounding 쿼리 요금 포함)
  logAiUsage({
    model: 'gemini-2.5-flash',
    usageType: 'hot_rating',
    promptTokens:   data.usageMetadata?.promptTokenCount    ?? 0,
    responseTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens:    data.usageMetadata?.totalTokenCount      ?? undefined,
  });

  if (!content) {
    throw new Error('No content in Gemini response');
  }

  return content;
}

/**
 * 핫 이벤트 평가 메인 함수
 */
export async function runHotRating() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[HotRating] GEMINI_API_KEY not set — skipping');
    return;
  }

  console.log('[HotRating] 🚀 Starting AI hot event rating...');

  // 1. 진행 중인 전시/공연/축제 조회 (100개)
  const events = await pool.query(`
    SELECT id, title, venue, main_category, start_at, end_at, overview, buzz_score
    FROM canonical_events
    WHERE 
      main_category IN ('전시', '공연', '축제')
      AND start_at <= NOW() + INTERVAL '30 days'
      AND end_at >= NOW()
      AND is_deleted = false
    ORDER BY buzz_score DESC
    LIMIT 100
  `);

  if (events.rowCount === 0) {
    console.log('[HotRating] No events to rate');
    return;
  }

  console.log(`[HotRating] Found ${events.rowCount} events to rate`);

  // 2. 이벤트 리스트 생성
  const eventList = events.rows.map((e, idx) => {
    // DB에서 string 또는 Date 객체 둘 다 처리
    const startDate = new Date(e.start_at).toISOString().split('T')[0];
    const endDate   = new Date(e.end_at).toISOString().split('T')[0];
    return `${idx + 1}. [${e.main_category}] ${e.title} (${e.venue}, ${startDate} ~ ${endDate})`;
  }).join('\n');

  // 3. AI에게 핫함 점수 요청
  const prompt = `당신은 전시/공연/축제 큐레이터입니다.

아래 이벤트 목록에서 **지금 가장 핫한 것**을 선별하고 점수를 매겨주세요.

# 이벤트 목록
${eventList}

# 점수 기준
- 100: 엄청 핫함 (SNS 화제, 예약 필수, 인생샷 명소, 유명 작가)
- 70-90: 핫함 (인기 많음, 추천할 만함)
- 50-70: 보통
- 50 이하: 마이너

# 출력 형식 (JSON 배열만, 70점 이상만)
\`\`\`json
[
  {
    "index": 1,
    "hotness_score": 95,
    "reason": "SNS 화제, 인생샷 명소"
  },
  {
    "index": 5,
    "hotness_score": 85,
    "reason": "유명 작가 전시, 예약 필수"
  }
]
\`\`\`

**70점 이상인 것만 출력하세요. JSON 배열만 출력하세요.**
`;

  try {
    const content = await callGeminiWithGrounding(prompt);

    // JSON 추출
    let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\[[\s\S]*\]/);
    }

    if (!jsonMatch) {
      console.error('[HotRating] No JSON found in response');
      return;
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    let ratings: HotRating[];
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        console.warn(`[HotRating] Unexpected JSON shape (not array): ${jsonText.substring(0, 200)}`);
        return;
      }
      ratings = parsed;
    } catch (parseErr: any) {
      console.warn(`[HotRating] JSON parse failed: ${parseErr.message}`);
      console.warn(`[HotRating] Raw text: ${jsonText.substring(0, 200)}`);
      return;
    }

    console.log(`[HotRating] AI rated ${ratings.length} events as hot (70+ score)`);

    // 4. buzz_components에 ai_hotness 저장
    let updatedCount = 0;
    for (const rating of ratings) {
      const event = events.rows[rating.index - 1];
      if (!event) {
        console.warn(`[HotRating] Invalid index: ${rating.index}`);
        continue;
      }

      await pool.query(`
        UPDATE canonical_events
        SET 
          buzz_components = COALESCE(buzz_components, '{}'::jsonb) || 
            jsonb_build_object('ai_hotness', $1::jsonb),
          updated_at = NOW()
        WHERE id = $2
      `, [
        JSON.stringify({
          score: rating.hotness_score,
          reason: rating.reason,
          rated_at: new Date().toISOString(),
        }),
        event.id
      ]);

      console.log(`[HotRating] ✅ ${event.title} → ${rating.hotness_score} (${rating.reason})`);
      updatedCount++;
    }

    console.log(`
[HotRating] 📊 Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total evaluated: ${events.rowCount}
  ✅ Hot events (70+): ${updatedCount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);

  } catch (error: any) {
    console.error('[HotRating] Error:', error.message);
    throw error;
  }
}

// CLI 실행
if (require.main === module) {
  runHotRating()
    .then(() => {
      console.log('[HotRating] ✅ Job completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[HotRating] ❌ Job failed:', error);
      process.exit(1);
    });
}

