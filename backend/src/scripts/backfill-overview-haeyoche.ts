/**
 * Overview 해요체 백필 스크립트
 *
 * DB에 저장된 overview 중 합니다체(입니다/합니다/됩니다 등)가 포함된 것을
 * Gemini AI를 통해 해요체로 변환합니다.
 *
 * 실행:
 *   npm run backfill:overview:haeyoche:dry   # dry-run (DB 미반영)
 *   npm run backfill:overview:haeyoche       # 전체 실행
 *   npm run backfill:overview:haeyoche -- --limit=20  # 20개만
 */

import { pool } from '../db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logGeminiUsage } from '../lib/aiUsageLogger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro';

// ─── 합니다체 판별 패턴 ──────────────────────────────────────────────────────
// overview 내에 합니다체 종결어미가 하나라도 있으면 변환 대상
const HABNIDA_PATTERN = /입니다[.!]|합니다[.!]|됩니다[.!]|있습니다[.!]|없습니다[.!]|습니다[.!]/;

function needsConversion(overview: string): boolean {
  return HABNIDA_PATTERN.test(overview);
}

// ─── Gemini 초기화 ────────────────────────────────────────────────────────────
function createModel() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      topP: 0.8,
      topK: 10,
    },
  });
}

// ─── 해요체 변환 ──────────────────────────────────────────────────────────────
async function convertToHaeyoche(
  model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
  overview: string,
  eventTitle: string,
): Promise<string | null> {
  const prompt = `아래 이벤트 소개글을 **해요체**로 변환해주세요.

## 규칙
- 종결어미 변환: ~입니다 → ~이에요/예요, ~합니다 → ~해요, ~됩니다 → ~돼요, ~있습니다 → ~있어요, ~없습니다 → ~없어요
- 내용은 그대로 유지 (단어, 사실, 정보 변경 금지)
- 문장 구조 유지 (순서, 단락 변경 금지)
- 과도한 경어 제거: ~하시다 → ~하다, 계시다 → 있다
- 변환된 텍스트만 출력 (설명, 따옴표, 마크다운 불필요)

## 이벤트명
${eventTitle}

## 원문
${overview}

## 변환 결과`;

  try {
    const result = await model.generateContent(prompt);
    logGeminiUsage(result.response, GEMINI_MODEL, 'extraction');
    const text = result.response.text().trim();

    // 빈 응답 또는 너무 짧은 응답 거부
    if (!text || text.length < 10) {
      return null;
    }

    // 원문보다 2배 이상 길어지면 이상 응답으로 판단
    if (text.length > overview.length * 2) {
      console.warn(`  ⚠️  변환 결과가 너무 김 (원문: ${overview.length}자, 결과: ${text.length}자), 스킵`);
      return null;
    }

    return text;
  } catch (err: any) {
    console.error(`  ❌ Gemini 오류: ${err.message}`);
    return null;
  }
}

// ─── DB 업데이트 ──────────────────────────────────────────────────────────────
async function updateOverview(id: string, overview: string): Promise<void> {
  await pool.query(
    `UPDATE canonical_events SET overview = $1, updated_at = NOW() WHERE id = $2`,
    [overview, id],
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  console.log('\n========================================');
  console.log('🔄 Overview 해요체 백필');
  console.log('========================================');
  console.log(`Mode   : ${dryRun ? 'DRY-RUN (DB 미반영)' : 'LIVE'}`);
  console.log(`Limit  : ${limit ?? '전체'}`);
  console.log('========================================\n');

  // 합니다체가 포함된 overview 조회
  const query = `
    SELECT id, title, main_category, overview, manually_edited_fields
    FROM canonical_events
    WHERE is_deleted = false
      AND status IN ('scheduled', 'ongoing')
      AND overview IS NOT NULL
      AND TRIM(overview) != ''
      AND (
        overview LIKE '%입니다.%' OR overview LIKE '%합니다.%' OR
        overview LIKE '%됩니다.%' OR overview LIKE '%있습니다.%' OR
        overview LIKE '%없습니다.%' OR overview LIKE '%습니다.%'
      )
    ORDER BY created_at DESC
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const { rows } = await pool.query(query);

  console.log(`📊 합니다체 overview 대상: ${rows.length}개\n`);

  if (rows.length === 0) {
    console.log('✅ 변환 대상 없음');
    await pool.end();
    return;
  }

  const model = createModel();

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const event = rows[i];
    const { id, title, overview, manually_edited_fields } = event;

    process.stdout.write(`[${i + 1}/${rows.length}] ${title.slice(0, 40)}... `);

    // 수동 편집된 overview는 건드리지 않음
    if (manually_edited_fields?.overview === true) {
      console.log('→ 수동 편집 필드, 스킵');
      skipped++;
      continue;
    }

    // 이미 해요체면 스킵
    if (!needsConversion(overview)) {
      console.log('→ 이미 해요체, 스킵');
      skipped++;
      continue;
    }

    const converted_text = await convertToHaeyoche(model, overview, title);

    if (!converted_text) {
      console.log('→ 변환 실패');
      failed++;
    } else if (!dryRun) {
      await updateOverview(id, converted_text);
      console.log('→ ✅ 변환 완료');
      converted++;
    } else {
      console.log('→ [DRY-RUN] 변환 성공');
      console.log(`   원문: ${overview.slice(0, 80)}...`);
      console.log(`   변환: ${converted_text.slice(0, 80)}...`);
      converted++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n========================================');
  console.log('📊 완료');
  console.log(`  ✅ 변환: ${converted}`);
  console.log(`  ⏭️  스킵: ${skipped}`);
  console.log(`  ❌ 실패: ${failed}`);
  console.log('========================================\n');

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
