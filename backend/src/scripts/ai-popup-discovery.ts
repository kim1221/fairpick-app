/**
 * AI 팝업 발굴 (Grounding 사용)
 * 
 * **핵심:**
 * - AI가 Google Search로 서울 팝업 전체 수집
 * - 내 DB (canonical_events)에 없는 것만 admin_hot_suggestions에 추가
 * - Admin이 승인하면 canonical_events에 추가
 * 
 * **비용:** ~$0.30/월
 * **실행:** 매일 08:00 KST
 */

import { pool } from '../db';
import * as dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('[PopupDiscovery] GEMINI_API_KEY not set');
  process.exit(1);
}

interface PopupData {
  title: string;
  venue?: string;
  region?: string;
  start_date?: string;
  end_date?: string;
  description: string;
  category: string;
  hotness_score?: number;
}

// 포괄적 질문 풀 (커버리지 최대화)
const POPUP_QUERIES = [
  // 🧪 테스트용: 3개만 (전체 15개는 주석 처리)
  "서울 성수동 홍대 강남에서 지금 진행 중이거나 곧 오픈하는 모든 팝업스토어 리스트",
  "더현대 서울 롯데백화점 코엑스몰 현재 진행 중인 모든 팝업",
  "2026년 2월 3월 오픈 예정인 서울 모든 팝업 전체",
  
  // TODO: 테스트 완료 후 아래 주석 해제
  // "한남동 이태원 경리단길 모든 팝업",
  // "현대백화점 압구정본점 모든 팝업",
  // "무신사 올리브영 팝업 전체",
  // "이번 주 새로 오픈한 서울 모든 팝업",
  // "서울 뷰티/화장품 브랜드 팝업 전체",
  // "서울 캐릭터/IP 팝업 모든 것",
  // "서울 패션 브랜드 팝업 전체",
  // "서울 F&B 팝업 모든 것",
];

/**
 * 내 DB (canonical_events)에 이미 있는지 체크
 */
async function isAlreadyInDB(title: string, venue?: string): Promise<boolean> {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, '');

  const result = await pool.query(`
    SELECT id FROM canonical_events
    WHERE
      LOWER(REPLACE(title, ' ', '')) = $1
      OR (
        $2::text IS NOT NULL
        AND LOWER(REPLACE(venue, ' ', '')) LIKE '%' || LOWER(REPLACE($2::text, ' ', '')) || '%'
      )
    LIMIT 1
  `, [normalizedTitle, venue || null]);

  return result.rowCount! > 0;
}

/**
 * admin_hot_suggestions에 이미 있는지 체크 (pending만)
 */
async function isAlreadySuggested(title: string): Promise<boolean> {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, '');
  
  const result = await pool.query(`
    SELECT id FROM admin_hot_suggestions
    WHERE LOWER(REPLACE(title, ' ', '')) = $1
    AND status = 'pending'
    LIMIT 1
  `, [normalizedTitle]);

  return result.rowCount! > 0;
}

/**
 * Gemini API 호출 (Grounding 사용)
 */
async function callGeminiWithGrounding(prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }]
        }],
        tools: [{
          google_search: {}
        }],
        generationConfig: {
          temperature: 0.2, // 낮은 temperature = 환각 감소
        }
      })
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error('[Gemini API] Error details:', JSON.stringify(errorData, null, 2));
    throw new Error(`Gemini API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!content) {
    throw new Error('No content in Gemini response');
  }

  return content;
}

/**
 * 팝업 발굴 메인 함수
 */
export async function runPopupDiscovery() {
  console.log('[PopupDiscovery] 🚀 Starting AI popup discovery...');

  const today = new Date().toISOString().split('T')[0];
  const allPopups: Map<string, PopupData> = new Map();

  // 각 질문마다 팝업 수집
  for (const query of POPUP_QUERIES) {
    console.log(`[PopupDiscovery] Querying: ${query}`);

    const prompt = `당신은 팝업스토어 수집 전문가입니다. 오늘은 ${today}입니다.

**질문: ${query}**

# 중요 조건
- **실제로 존재하는 팝업**만 알려주세요
- **2026년 2월 이후** 진행되는 것만
- 과거 종료된 것은 절대 포함하지 마세요
- 유명한 것뿐만 아니라 **작은 팝업도 포함**
- **최대한 많이** (30-50개 목표)
- 각 팝업마다 **핫함 점수** (1-100) 매기기
  - 100: 엄청 핫함 (SNS 화제, 예약 필수)
  - 70-90: 핫함
  - 50-70: 보통
  - 50 이하: 마이너

# 출력 형식 (JSON 배열만)
\`\`\`json
[
  {
    "title": "팝업 제목",
    "venue": "장소명",
    "region": "지역 (예: 서울 성동구)",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "description": "설명 (2-3문장)",
    "category": "팝업",
    "hotness_score": 85
  }
]
\`\`\`

**가능한 한 많이 (30개 이상) 알려주세요. JSON 배열만 출력하세요.**
`;

    try {
      const content = await callGeminiWithGrounding(prompt);

      // JSON 추출
      let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
      if (!jsonMatch) {
        jsonMatch = content.match(/\[[\s\S]*\]/);
      }

      if (!jsonMatch) {
        console.warn(`[PopupDiscovery] No JSON found in response`);
        console.warn(`[PopupDiscovery] Response preview: ${content.substring(0, 500)}...`);
        continue;
      }

      const jsonText = jsonMatch[1] || jsonMatch[0];
      const popups: PopupData[] = JSON.parse(jsonText);

      console.log(`[PopupDiscovery] Found ${popups.length} popups`);

      // 중복 제거 (제목 기준)
      for (const popup of popups) {
        const key = popup.title.toLowerCase().trim();
        
        // 이미 있으면 hotness_score 높은 것 유지
        if (allPopups.has(key)) {
          const existing = allPopups.get(key)!;
          if ((popup.hotness_score || 0) > (existing.hotness_score || 0)) {
            allPopups.set(key, popup);
          }
        } else {
          allPopups.set(key, popup);
        }
      }

      // Rate Limit (Gemini API 보호)
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3초

    } catch (error: any) {
      console.error(`[PopupDiscovery] Error for "${query}":`, error.message);
    }
  }

  console.log(`[PopupDiscovery] Total unique popups collected: ${allPopups.size}`);

  // DB 중복 체크 후 저장
  let savedCount = 0;
  let skippedExisting = 0;
  let skippedSuggested = 0;

  for (const [_, popup] of allPopups) {
    try {
      // 1. canonical_events에 이미 있는지 체크
      let existsInDB = false;
      try {
        existsInDB = await isAlreadyInDB(popup.title, popup.venue);
      } catch (dbCheckError: any) {
        console.error(`[PopupDiscovery] DB check error for "${popup.title}":`, dbCheckError.message);
        continue;
      }
      
      if (existsInDB) {
        console.log(`[PopupDiscovery] ⏭️  Skipped (already in DB): ${popup.title}`);
        skippedExisting++;
        continue;
      }

      // 2. admin_hot_suggestions에 이미 있는지 체크
      let alreadySuggested = false;
      try {
        alreadySuggested = await isAlreadySuggested(popup.title);
      } catch (suggestCheckError: any) {
        console.error(`[PopupDiscovery] Suggestion check error for "${popup.title}":`, suggestCheckError.message);
        continue;
      }
      
      if (alreadySuggested) {
        console.log(`[PopupDiscovery] ⏭️  Skipped (already suggested): ${popup.title}`);
        skippedSuggested++;
        continue;
      }

      // 3. 새로운 팝업이면 저장
      const params = [
        popup.title,
        popup.venue || null,
        popup.region || null,
        popup.description || null,
        popup.hotness_score || 50,
        JSON.stringify({
          category: popup.category || null,
          start_date: popup.start_date || null,
          end_date: popup.end_date || null,
          hotness_score: popup.hotness_score || null,
          ai_generated: true,
        })
      ];

      await pool.query(`
        INSERT INTO admin_hot_suggestions (
          id, title, venue, region, link, description,
          source, candidate_score, evidence_links, evidence_count,
          status, created_at, metadata
        ) VALUES (
          gen_random_uuid(),
          $1::text, $2::text, $3::text, ''::text, $4::text,
          'ai_popup'::text,
          $5::integer,
          ARRAY[]::text[],
          0,
          'pending'::text,
          NOW(),
          $6::jsonb
        )
      `, params);
      
      console.log(`[PopupDiscovery] ✅ Saved: ${popup.title} (score: ${popup.hotness_score})`);
      savedCount++;

    } catch (error: any) {
      console.error(`[PopupDiscovery] Save error for "${popup.title}":`, error.message);
      console.error(`[PopupDiscovery] Debug - venue: "${popup.venue}", region: "${popup.region}", description length: ${popup.description?.length || 0}`);
      console.error(`[PopupDiscovery] Stack:`, error.stack?.split('\n')[1]);
    }
  }

  console.log(`
[PopupDiscovery] 📊 Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total collected: ${allPopups.size}
  ✅ Saved (new): ${savedCount}
  ⏭️  Skipped (already in DB): ${skippedExisting}
  ⏭️  Skipped (already suggested): ${skippedSuggested}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}

// CLI 실행
if (require.main === module) {
  runPopupDiscovery()
    .then(() => {
      console.log('[PopupDiscovery] ✅ Job completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[PopupDiscovery] ❌ Job failed:', error);
      process.exit(1);
    });
}

