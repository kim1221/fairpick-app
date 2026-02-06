/**
 * Admin Hot Discovery (3-AI 하이브리드 방식)
 * 
 * **파이프라인**:
 * 1. Blog+Web+Cafe 동시 검색 (GPT 제안)
 * 2. 리스트 포스팅 필터링 (퍼플렉시티 제안)
 * 3. LLM 배치: Seed 생성 (GPT 제안, 10개씩 배치)
 * 4. Seed별 재검색 (GPT 제안)
 * 5. Local API 검증 (제미나이 제안)
 * 6. 룰 스코어링 (퍼플렉시티 제안)
 * 7. LLM 배치: 정리/중복제거 (GPT 제안)
 * 8. 증거 기반 합의 (GPT 제안)
 * 
 * **AI 비용**: $0.16/월 (배치 처리, 90% 절감)
 * **실행 시간**: 매일 오전 8시
 */

import { searchNaverBlog, searchNaverWeb, searchNaverCafe, searchNaverPlace, stripHtmlTags } from '../lib/naverApi';
import { pool } from '../db';
import { extractEventSeeds, normalizeAndDeduplicateEvents } from '../lib/aiExtractor';

// ==================== 타입 정의 ====================

export interface AdminHotSuggestion {
  id: string;
  title: string;
  venue?: string;
  region?: string;
  link: string;
  description: string;
  source: 'blog' | 'web' | 'cafe';
  postdate?: string;
  candidate_score: number;
  evidence_links: string[]; // 증거 링크 (합의 기반)
  evidence_count: number; // 증거 개수
  status: 'pending' | 'approved' | 'rejected';
  created_at: Date;
  reviewed_at?: Date;
  reviewed_by?: string;
  metadata: any;
}

interface Candidate {
  title: string;
  venue?: string;
  region?: string;
  link: string;
  description: string;
  source: 'blog' | 'web' | 'cafe';
  postdate?: string;
  score: number;
  evidence_links: string[];
  evidence_count: number;
  metadata?: any;
}

// ==================== 키워드 풀 ====================

const KEYWORD_POOL = {
  // L1: 힙한 동네 + 백화점 (제미나이 필수!)
  L1_regions: [
    // 힙한 동네
    '성수', '한남', '연남', '이태원', '을지로',
    '압구정', '청담', '가로수길', '삼청동',
    
    // 백화점 (제미나이 필수!)
    '더현대 서울',
    '현대백화점 압구정본점',
    '롯데백화점 잠실점',
    '롯데백화점 본점',
    '신세계백화점 강남점',
    '신세계백화점 센텀시티',
    
    // 복합몰
    '코엑스',
    '스타필드 하남',
    '스타필드 고양',
    'IFC몰',
  ],
  
  // L2: 이벤트 타입
  L2_types: [
    '팝업', '팝업스토어',
    '플리마켓', '마켓',
    '전시', '전시회',
    '체험', '콜라보', '굿즈',
  ],
  
  // L3: 시간 (제미나이 추가: 오늘/내일)
  L3_time: [
    '이번주', '주말', '2월', '3월',
    '오늘',     // 제미나이 추가!
    '내일',     // 제미나이 추가!
    '오픈', '사전예약', '신규오픈',
  ],
};

// ==================== 키워드 샘플링 ====================

/**
 * 키워드 조합 샘플링 (테스트용: 10개 / 프로덕션: 90개)
 */
function sampleKeywords(count: number = 10): string[] {
  const keywords: string[] = [];
  
  const halfCount = Math.floor(count / 2);
  
  // 1. L1 × L2 조합
  for (let i = 0; i < halfCount; i++) {
    const region = KEYWORD_POOL.L1_regions[Math.floor(Math.random() * KEYWORD_POOL.L1_regions.length)];
    const type = KEYWORD_POOL.L2_types[Math.floor(Math.random() * KEYWORD_POOL.L2_types.length)];
    keywords.push(`${region} ${type}`);
  }
  
  // 2. L1 × L2 × L3 조합
  for (let i = 0; i < count - halfCount; i++) {
    const region = KEYWORD_POOL.L1_regions[Math.floor(Math.random() * KEYWORD_POOL.L1_regions.length)];
    const type = KEYWORD_POOL.L2_types[Math.floor(Math.random() * KEYWORD_POOL.L2_types.length)];
    const time = KEYWORD_POOL.L3_time[Math.floor(Math.random() * KEYWORD_POOL.L3_time.length)];
    keywords.push(`${region} ${type} ${time}`);
  }
  
  // 중복 제거
  return Array.from(new Set(keywords));
}

// ==================== Step 1-2: 검색 & 리스트 포스팅 필터링 ====================

/**
 * Step 1: Blog+Web+Cafe 동시 검색 (GPT 제안)
 */
async function searchAllSources(keyword: string): Promise<Array<{ title: string; description: string; link: string; source: 'blog' | 'web' | 'cafe'; postdate?: string }>> {
  try {
    const [blogResult, webResult, cafeResult] = await Promise.allSettled([
      searchNaverBlog({ query: keyword, display: 10, sort: 'date' }),
      searchNaverWeb({ query: keyword, display: 10 }),
      searchNaverCafe({ query: keyword, display: 10, sort: 'date' }),
    ]);

    const items: Array<{ title: string; description: string; link: string; source: 'blog' | 'web' | 'cafe'; postdate?: string }> = [];

    if (blogResult.status === 'fulfilled') {
      blogResult.value.items.forEach(item => {
        items.push({
          title: stripHtmlTags(item.title),
          description: stripHtmlTags(item.description),
          link: item.link,
          source: 'blog',
          postdate: item.postdate,
        });
      });
    }

    if (webResult.status === 'fulfilled') {
      webResult.value.items.forEach(item => {
        items.push({
          title: stripHtmlTags(item.title),
          description: stripHtmlTags(item.description),
          link: item.link,
          source: 'web',
        });
      });
    }

    if (cafeResult.status === 'fulfilled') {
      cafeResult.value.items.forEach(item => {
        items.push({
          title: stripHtmlTags(item.title),
          description: stripHtmlTags(item.description),
          link: item.link,
          source: 'cafe',
        });
      });
    }

    return items;
  } catch (error: any) {
    console.error(`[AdminHotDiscovery] Search error for "${keyword}":`, error.message);
    return [];
  }
}

/**
 * Step 2: 리스트 포스팅 필터링 (퍼플렉시티 제안)
 */
function filterListPosts<T extends { title: string; description: string }>(items: T[]): T[] {
  return items.filter(item => {
    const text = item.title + ' ' + item.description;
    
    // 리스트 포스팅 패턴
    const listPatterns = [
      /\d+곳/,          // "8곳", "5곳"
      /\d+개/,          // "10개", "3개"
      /베스트\s?\d+/,   // "베스트 5"
      /TOP\s?\d+/i,    // "TOP 10"
      /추천\s?\d+/,     // "추천 5"
      /총정리/,
      /모음/,
      /정리/,
    ];

    for (const pattern of listPatterns) {
      if (pattern.test(text)) {
        return false; // 리스트 포스팅 제외
      }
    }

    // 과거 이벤트 필터링
    if (/(2020|2021|2022|2023|2024|2025)년/.test(text)) return false;
    if (/판매종료|공연종료|전시종료|마감|종료됨/.test(text)) return false;

    // 제외 키워드 (옷가게, 교회, 모임 등)
    const excludedKeywords = [
      // 옷가게/패션매장
      /의류|옷가게|패션스토어|정장|캐주얼|수입의류|온라인쇼핑몰/,
      /남성복|여성복|아동복|유니폼|빈티지의류/,
      
      // 교회/종교
      /교회|성당|사찰|절|예배|집회|기도회|예배당|목사|신부|스님/,
      /찬양|성경|말씀|선교|전도|교리|미사|법회/,
      
      // 모임/동호회
      /동호회|동아리|소모임|친목회|정기모임|회원모집|가입안내/,
      /단톡방|카톡방|오픈채팅|채팅방|참여방법/,
      
      // 일반 상점/서비스
      /미용실|헤어샵|네일샵|피부과|성형외과|치과|한의원|약국/,
      /부동산|분양|입주|청약|전세|월세|매매|평수/,
      /학원|과외|입시|수능|학습지|교습소|보습학원/,
      /수리|정비|세차|주유소|렌트|리스|할부|금융/,
      
      // 기업/B2B
      /채용|구인|구직|면접|지원서|이력서|사원모집|직원모집/,
      /법인|사업자|도매|납품|입찰|계약|용역|컨설팅/,
      
      // 부적절한 콘텐츠
      /성인|19금|야한|음란|도박|카지노|불법|사기|피싱/,
    ];

    for (const pattern of excludedKeywords) {
      if (pattern.test(text)) {
        return false;
      }
    }

    return true;
  });
}

// ==================== Step 3: LLM Seed 생성 (배치) ====================

/**
 * Step 3: Seed 생성 (GPT 제안, 배치 10개씩)
 */
async function extractSeedsFromKeywords(keywords: string[]): Promise<string[]> {
  const allSeeds: string[] = [];

  console.log(`[AdminHotDiscovery] [Step 3] Extracting seeds from ${keywords.length} keywords...`);

  for (const keyword of keywords) {
    try {
      // 검색
      const items = await searchAllSources(keyword);
      if (items.length === 0) continue;

      // 리스트 포스팅 필터링
      const filtered = filterListPosts(items);
      if (filtered.length === 0) continue;

      // AI Seed 추출 (배치 10개)
      const seeds = await extractEventSeeds(filtered.slice(0, 10));
      allSeeds.push(...seeds);

      // Rate Limit (Step 3 키워드 검색)
      await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5초
    } catch (error: any) {
      console.error(`[AdminHotDiscovery] [Step 3] Error for "${keyword}":`, error.message);
    }
  }

  console.log(`[AdminHotDiscovery] [Step 3] Total raw seeds: ${allSeeds.length}`);
  return allSeeds;
}

// ==================== Step 4-5: Seed별 재검색 & 검증 ====================

/**
 * Step 4: Seed별 재검색 (GPT 제안)
 * Step 5: Local API 검증 (제미나이 제안)
 */
async function searchAndVerifySeeds(seeds: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  console.log(`[AdminHotDiscovery] [Step 4-5] Searching ${seeds.length} seeds...`);

  for (const seed of seeds) {
    try {
      // 재검색: Blog + Web + Cafe + Local (병렬)
      const [blogResult, webResult, cafeResult, localResult] = await Promise.allSettled([
        searchNaverBlog({ query: seed + ' 2026', display: 5 }),
        searchNaverWeb({ query: seed + ' 2026', display: 5 }),
        searchNaverCafe({ query: seed + ' 2026', display: 5 }),
        searchNaverPlace({ query: seed, display: 3 }), // Local API로 검증
      ]);

      // 증거 링크 수집
      const evidenceLinks: string[] = [];
      if (blogResult.status === 'fulfilled') {
        blogResult.value.items.forEach(item => evidenceLinks.push(item.link));
      }
      if (webResult.status === 'fulfilled') {
        webResult.value.items.forEach(item => evidenceLinks.push(item.link));
      }
      if (cafeResult.status === 'fulfilled') {
        cafeResult.value.items.forEach(item => evidenceLinks.push(item.link));
      }

      // 증거 부족 시 스킵 (합의 기반, GPT 제안)
      if (evidenceLinks.length < 3) {
        console.log(`[AdminHotDiscovery] [Step 5] "${seed}" skipped (insufficient evidence: ${evidenceLinks.length})`);
        continue;
      }

      // ⭐ Local API 검증 (필수!) - 팝업/체험은 네이버 지도에 있어야 함
      let venue: string | undefined;
      let address: string | undefined;
      let isLocalVerified = false;
      
      if (localResult.status === 'fulfilled' && localResult.value.items.length > 0) {
        const place = localResult.value.items[0];
        venue = stripHtmlTags(place.title);
        address = place.roadAddress || place.address;
        isLocalVerified = true;
      }

      // 팝업/체험은 네이버 지도 검증 필수 (전시/공연은 선택)
      const requiresLocalVerification = /팝업|팝업스토어|체험|스토어|카페|플래그십|매장/.test(seed);
      if (requiresLocalVerification && !isLocalVerified) {
        console.log(`[AdminHotDiscovery] [Step 5] "${seed}" skipped (requires local verification)`);
        continue;
      }

      // 대표 링크 선택 (블로그 우선)
      let representativeLink = evidenceLinks[0];
      let representativeDesc = '';
      let representativePostdate: string | undefined;
      let representativeSource: 'blog' | 'web' | 'cafe' = 'blog';

      if (blogResult.status === 'fulfilled' && blogResult.value.items.length > 0) {
        const item = blogResult.value.items[0];
        representativeLink = item.link;
        representativeDesc = stripHtmlTags(item.description);
        representativePostdate = item.postdate;
        representativeSource = 'blog';
      } else if (cafeResult.status === 'fulfilled' && cafeResult.value.items.length > 0) {
        const item = cafeResult.value.items[0];
        representativeLink = item.link;
        representativeDesc = stripHtmlTags(item.description);
        representativeSource = 'cafe';
      } else if (webResult.status === 'fulfilled' && webResult.value.items.length > 0) {
        const item = webResult.value.items[0];
        representativeLink = item.link;
        representativeDesc = stripHtmlTags(item.description);
        representativeSource = 'web';
      }

      // Candidate 생성
      const candidate: Candidate = {
        title: seed,
        venue,
        region: extractRegion(address || ''),
        link: representativeLink,
        description: representativeDesc,
        source: representativeSource,
        postdate: representativePostdate,
        score: 0, // Step 6에서 계산
        evidence_links: evidenceLinks.slice(0, 10), // 최대 10개
        evidence_count: evidenceLinks.length,
        metadata: {
          local_verified: isLocalVerified,
          address,
        },
      };

      candidates.push(candidate);

      // Rate Limit (네이버 API 429 방지)
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 (안전)
    } catch (error: any) {
      console.error(`[AdminHotDiscovery] [Step 4-5] Error for "${seed}":`, error.message);
    }
  }

  console.log(`[AdminHotDiscovery] [Step 4-5] ${candidates.length} candidates verified`);
  return candidates;
}

/**
 * 주소에서 지역 추출
 */
function extractRegion(address: string): string | undefined {
  const regions = ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
  for (const region of regions) {
    if (address.includes(region)) {
      return region;
    }
  }
  return undefined;
}

// ==================== Step 6: 룰 스코어링 ====================

/**
 * Step 6: 룰 기반 Candidate Score 계산 (퍼플렉시티 제안)
 */
function calculateCandidateScore(candidate: Candidate): number {
  let score = 50; // 기본 점수

  // 증거 개수 (GPT 합의 기반)
  if (candidate.evidence_count >= 10) score += 30;
  else if (candidate.evidence_count >= 5) score += 20;
  else if (candidate.evidence_count >= 3) score += 10;

  // Local API 검증 (제미나이 제안)
  if (candidate.metadata?.local_verified) score += 20;

  // 최신성 (postdate)
  if (candidate.postdate) {
    const postDateObj = new Date(
      parseInt(candidate.postdate.substring(0, 4)),
      parseInt(candidate.postdate.substring(4, 6)) - 1,
      parseInt(candidate.postdate.substring(6, 8))
    );
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    if (postDateObj >= sevenDaysAgo) {
      score += 15; // 7일 이내
    }
  }

  // 키워드 가산점
  const text = candidate.title + ' ' + candidate.description;
  if (/팝업|팝업스토어/.test(text)) score += 10;
  if (/오픈|신규오픈|오픈런/.test(text)) score += 10;
  if (/한정|기간한정|선착순/.test(text)) score += 5;
  if (/콜라보|협업/.test(text)) score += 5;

  // 힙한 장소 가산점
  const hipPlaces = ['성수', '한남', '연남', '이태원', '을지로', '압구정', '청담', '가로수길', '삼청동', '더현대', '롯데 잠실', '신세계 강남', '코엑스', '스타필드', 'IFC몰'];
  if (hipPlaces.some(place => text.includes(place))) {
    score += 10;
  }

  return Math.min(100, score);
}

// ==================== Step 7: LLM 정리/중복제거 (배치) ====================

/**
 * Step 7: 정리 및 중복 제거 (GPT 제안, 배치)
 */
async function normalizeAndDeduplicate(candidates: Candidate[]): Promise<Candidate[]> {
  console.log(`[AdminHotDiscovery] [Step 7] Normalizing ${candidates.length} candidates...`);

  // 제목만 추출
  const titles = candidates.map(c => c.title);

  // AI로 정규화 및 중복 제거
  const normalizedTitles = await normalizeAndDeduplicateEvents(titles);

  // 정규화된 제목에 해당하는 candidates만 필터링
  const titleToCandidate = new Map<string, Candidate>();
  candidates.forEach(c => {
    if (normalizedTitles.includes(c.title)) {
      if (!titleToCandidate.has(c.title) || (titleToCandidate.get(c.title)!.score < c.score)) {
        titleToCandidate.set(c.title, c);
      }
    }
  });

  const deduplicated = Array.from(titleToCandidate.values());

  console.log(`[AdminHotDiscovery] [Step 7] ${deduplicated.length} unique candidates after normalization`);
  return deduplicated;
}

// ==================== DB 저장 ====================

/**
 * admin_hot_suggestions 테이블에 저장
 */
async function saveSuggestions(candidates: Candidate[]): Promise<void> {
  console.log(`[AdminHotDiscovery] Saving ${candidates.length} suggestions...`);

  // 테이블이 없으면 생성
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
      evidence_links TEXT[], -- 증거 링크 배열
      evidence_count INTEGER, -- 증거 개수
      status TEXT DEFAULT 'pending', -- pending, approved, rejected
      created_at TIMESTAMP DEFAULT NOW(),
      reviewed_at TIMESTAMP,
      reviewed_by TEXT,
      metadata JSONB DEFAULT '{}'
    );
  `);

  // 기존 테이블에 컬럼 추가 (이미 있으면 무시)
  try {
    await pool.query(`
      ALTER TABLE admin_hot_suggestions 
      ADD COLUMN IF NOT EXISTS evidence_links TEXT[],
      ADD COLUMN IF NOT EXISTS evidence_count INTEGER;
    `);
  } catch (error: any) {
    // 컬럼이 이미 있으면 무시
    if (error.code !== '42701') {
      throw error;
    }
  }

  // 기존 pending 제거 (매일 새로 생성)
  await pool.query(`
    DELETE FROM admin_hot_suggestions
    WHERE status = 'pending'
  `);

  // 새 후보 삽입
  for (const candidate of candidates) {
    await pool.query(
      `INSERT INTO admin_hot_suggestions (
        title, venue, region, link, description, postdate, source, candidate_score, evidence_links, evidence_count, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        candidate.title,
        candidate.venue,
        candidate.region,
        candidate.link,
        candidate.description,
        candidate.postdate,
        candidate.source,
        Math.round(candidate.score),
        candidate.evidence_links, // 배열로 저장
        candidate.evidence_count,
        JSON.stringify(candidate.metadata || {}),
      ]
    );
  }

  console.log(`[AdminHotDiscovery] ✅ ${candidates.length} suggestions saved`);
}

// ==================== 메인 함수 ====================

export async function runAdminHotDiscovery(): Promise<void> {
  const startTime = Date.now();
  console.log('[AdminHotDiscovery] 🚀 Starting 3-AI hybrid discovery job...');

  try {
    // Step 1-2: 키워드 샘플링 & 검색 & 필터링
    // 테스트: 10개, 프로덕션: 90개
    const keywords = sampleKeywords(10); // ⚠️ 테스트용! 프로덕션에서는 90으로 변경
    console.log(`[AdminHotDiscovery] Sampled ${keywords.length} keywords`);

    // Step 3: LLM Seed 생성 (배치)
    const rawSeeds = await extractSeedsFromKeywords(keywords);

    // Step 4-5: Seed별 재검색 & 검증
    const verifiedCandidates = await searchAndVerifySeeds(rawSeeds);

    // Step 6: 룰 스코어링
    verifiedCandidates.forEach(candidate => {
      candidate.score = calculateCandidateScore(candidate);
    });

    // Step 7: LLM 정리/중복제거 (배치)
    const normalized = await normalizeAndDeduplicate(verifiedCandidates);

    // 상위 50개만 저장
    const top50 = normalized
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    // Step 8: DB 저장
    await saveSuggestions(top50);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[AdminHotDiscovery] ✅ Job completed in ${elapsed}s`);
    console.log(`[AdminHotDiscovery] 📊 Stats: ${keywords.length} keywords → ${rawSeeds.length} seeds → ${verifiedCandidates.length} verified → ${normalized.length} normalized → ${top50.length} saved`);
  } catch (error: any) {
    console.error('[AdminHotDiscovery] ✗ Job failed:', error);
    throw error;
  }
}

// ==================== CLI 실행용 ====================

async function main() {
  try {
    await runAdminHotDiscovery();
    console.log('[AdminHotDiscovery] Done');
    process.exit(0);
  } catch (error) {
    console.error('[AdminHotDiscovery] Fatal error:', error);
    process.exit(1);
  }
}

// CLI에서 직접 실행 시
if (require.main === module) {
  main();
}
