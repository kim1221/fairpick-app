/**
 * Mock 데이터로 Admin Hot Discovery 테스트
 * (네이버 API Rate Limit 회피)
 */

import { pool } from '../db';
import { extractEventSeeds, normalizeAndDeduplicateEvents } from '../lib/aiExtractor';

// Mock 데이터
const mockBlogItems = [
  {
    title: '성수동 노티드 팝업스토어 다녀왔어요',
    description: '노티드 시그니처 디저트와 산리오 캐릭터 콜라보 굿즈를 만나볼 수 있어요. 포토존도 있고 대기 시간은 평일 30분 정도',
    link: 'https://blog.naver.com/test1',
  },
  {
    title: '한남동 헬로키티 카페 후기',
    description: '헬로키티 애플카페가 한남동에 오픈했어요. 시그니처 애플파이와 키티 라떼 추천합니다',
    link: 'https://blog.naver.com/test2',
  },
  {
    title: '더현대 서울 팝업 5곳 추천',
    description: '이번주 더현대에서 열리는 팝업 총정리',
    link: 'https://blog.naver.com/test3',
  },
  {
    title: '성수동 쿠키런 팝업 오픈런 필수!',
    description: '쿠키런 킹덤 팝업이 성수에 오픈했어요. 한정 굿즈는 주말에 12시면 품절',
    link: 'https://blog.naver.com/test4',
  },
  {
    title: '청담 무신사 팝업 다녀옴',
    description: '무신사 스탠다드 팝업스토어 청담점. 한정판 스니커즈 판매 중',
    link: 'https://blog.naver.com/test5',
  },
];

interface Candidate {
  title: string;
  venue?: string;
  region?: string;
  link: string;
  description: string;
  source: 'blog' | 'web' | 'cafe';
  score: number;
  evidence_links: string[];
  evidence_count: number;
  metadata?: any;
}

// 리스트 포스팅 필터링
function filterListPosts<T extends { title: string; description: string }>(items: T[]): T[] {
  return items.filter(item => {
    const text = item.title + ' ' + item.description;
    const listPatterns = [/\d+곳/, /\d+개/, /총정리/, /모음/];
    return !listPatterns.some(pattern => pattern.test(text));
  });
}

// Mock Seed 추출
async function testSeedExtraction() {
  console.log('\n[Test] Step 1: Seed 추출 테스트');
  console.log('='.repeat(60));

  const filtered = filterListPosts(mockBlogItems);
  console.log(`✅ 필터링: ${mockBlogItems.length}개 → ${filtered.length}개`);

  const seeds = await extractEventSeeds(filtered);
  console.log(`✅ AI Seed 추출: ${seeds.length}개`);
  console.log('Seeds:', seeds);

  return seeds;
}

// Mock 정규화
async function testNormalization(seeds: string[]) {
  console.log('\n[Test] Step 2: 정규화 테스트');
  console.log('='.repeat(60));

  const normalized = await normalizeAndDeduplicateEvents(seeds);
  console.log(`✅ 정규화: ${seeds.length}개 → ${normalized.length}개`);
  console.log('Normalized:', normalized);

  return normalized;
}

// Mock Candidate 생성
function createMockCandidates(eventNames: string[]): Candidate[] {
  const venues = ['성수동', '한남동', '청담동', '더현대 서울'];
  const regions = ['서울', '서울', '서울', '서울'];

  return eventNames.map((name, idx) => ({
    title: name,
    venue: venues[idx % venues.length],
    region: regions[idx % regions.length],
    link: `https://blog.naver.com/mock${idx}`,
    description: `${name} 관련 상세 정보`,
    source: 'blog' as const,
    score: 80 - idx * 5, // 점수 하락
    evidence_links: [
      `https://blog.naver.com/evidence${idx}_1`,
      `https://blog.naver.com/evidence${idx}_2`,
      `https://blog.naver.com/evidence${idx}_3`,
    ],
    evidence_count: 3 + idx,
    metadata: { local_verified: idx % 2 === 0 },
  }));
}

// Mock DB 저장
async function testSaveSuggestions(candidates: Candidate[]) {
  console.log('\n[Test] Step 3: DB 저장 테스트');
  console.log('='.repeat(60));

  // 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_hot_suggestions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      venue TEXT,
      region TEXT,
      link TEXT,
      description TEXT,
      postdate TEXT,
      source TEXT,
      candidate_score INTEGER,
      evidence_links TEXT[],
      evidence_count INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP,
      reviewed_by TEXT,
      metadata JSONB DEFAULT '{}'
    );
  `);

  // 컬럼 추가 (있으면 무시)
  try {
    await pool.query(`
      ALTER TABLE admin_hot_suggestions 
      ADD COLUMN IF NOT EXISTS evidence_links TEXT[],
      ADD COLUMN IF NOT EXISTS evidence_count INTEGER;
    `);
  } catch (error: any) {
    if (error.code !== '42701') throw error;
  }

  // 기존 pending 삭제
  await pool.query(`DELETE FROM admin_hot_suggestions WHERE status = 'pending'`);

  // 새 후보 삽입
  for (const candidate of candidates) {
    await pool.query(
      `INSERT INTO admin_hot_suggestions (
        title, venue, region, link, description, source, candidate_score, evidence_links, evidence_count, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        candidate.title,
        candidate.venue,
        candidate.region,
        candidate.link,
        candidate.description,
        candidate.source,
        Math.round(candidate.score),
        candidate.evidence_links,
        candidate.evidence_count,
        JSON.stringify(candidate.metadata || {}),
      ]
    );
  }

  console.log(`✅ DB 저장 완료: ${candidates.length}개`);

  // 결과 확인
  const result = await pool.query(`
    SELECT title, venue, candidate_score, evidence_count 
    FROM admin_hot_suggestions 
    WHERE status = 'pending' 
    ORDER BY candidate_score DESC
  `);

  console.log('\n📊 저장된 후보:');
  result.rows.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.title} (${row.venue}) - Score: ${row.candidate_score}, Evidence: ${row.evidence_count}`);
  });
}

// 메인 테스트
async function main() {
  const startTime = Date.now();
  console.log('🧪 [Mock Test] Admin Hot Discovery 파이프라인 테스트');
  console.log('='.repeat(60));

  try {
    // Step 1: Seed 추출
    const seeds = await testSeedExtraction();

    // Step 2: 정규화
    const normalized = await testNormalization(seeds);

    // Step 3: Mock Candidate 생성
    console.log('\n[Test] Step 2.5: Mock Candidate 생성');
    const candidates = createMockCandidates(normalized.slice(0, 5)); // 상위 5개만
    console.log(`✅ Candidate 생성: ${candidates.length}개`);

    // Step 4: DB 저장
    await testSaveSuggestions(candidates);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(60));
    console.log(`✅ 테스트 완료! (${elapsed}초)`);
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('✗ 테스트 실패:', error);
    process.exit(1);
  }
}

main();

