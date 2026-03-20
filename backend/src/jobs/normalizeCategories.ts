import {
  getCanonicalEventsForNormalizationDelta,
  updateCanonicalEventCategories,
} from '../db';

// 카테고리 정의
const MAIN_CATEGORIES = ['공연', '전시', '축제', '행사', '팝업'] as const;
type MainCategory = typeof MAIN_CATEGORIES[number];

const SUB_CATEGORIES: Record<MainCategory, readonly string[]> = {
  공연: ['뮤지컬', '연극', '콘서트', '클래식', '무용', '국악', '기타 공연'],
  전시: ['미술 전시', '사진 전시', '미디어아트', '체험형 전시', '어린이 전시', '특별전', '기타 전시'],
  축제: ['지역 축제', '음악 축제', '불꽃 / 드론 / 빛 축제', '계절 축제', '전통 / 문화 축제', '기타 축제'],
  행사: ['문화 행사', '체험 행사', '교육 / 강연', '마켓 / 플리마켓', '기념 행사', '가족 / 어린이', '기타 행사'],
  팝업: ['브랜드 팝업', '전시형 팝업', '체험형 팝업', 'F&B 팝업', '기타 팝업'],
};

// 기본 서브 카테고리 (매핑 실패 시)
const DEFAULT_SUB_CATEGORIES: Record<MainCategory, string> = {
  공연: '기타 공연',
  전시: '기타 전시',
  축제: '기타 축제',
  행사: '기타 행사',
  팝업: '기타 팝업',
};

// source_priority_winner 규칙
const SOURCE_PRIORITY: Record<MainCategory, string> = {
  공연: 'kopis',
  전시: 'culture',
  축제: 'tour',
  행사: 'culture',
  팝업: 'manual',
};

/**
 * 제목과 서브 카테고리 기반으로 메인 카테고리 추론
 */
function inferMainCategory(title: string, subCategory: string | null): MainCategory {
  const titleLower = (title || '').toLowerCase();
  const subLower = (subCategory || '').toLowerCase();
  const combined = titleLower + ' ' + subLower;

  // 팝업 키워드 (가장 먼저 체크 — '팝업스토어', '팝업'이 제목에 있으면 명확)
  const popupKeywords = [
    '팝업', 'popup', 'pop-up', 'pop up',
  ];
  if (popupKeywords.some(keyword => combined.includes(keyword))) {
    return '팝업';
  }

  // 공연 키워드
  const performanceKeywords = [
    '공연', '연극', '뮤지컬', '콘서트', '음악회', '리사이틀',
    '클래식', '오페라', '발레', '무용', '국악', '오케스트라',
    '쇼', '극', '무대',
  ];
  if (performanceKeywords.some(keyword => combined.includes(keyword))) {
    return '공연';
  }

  // 전시 키워드
  const exhibitionKeywords = [
    '전시', '박람회', '미술', '갤러리', '아트', '작품전',
    '사진전', '미디어아트', '체험', '특별전', '기획전',
  ];
  if (exhibitionKeywords.some(keyword => combined.includes(keyword))) {
    return '전시';
  }

  // 축제 키워드
  const festivalKeywords = [
    '축제', '페스티벌', 'festival', '불꽃', '드론쇼', '빛축제',
    '벚꽃', '단풍', '눈꽃', '음악제', '재즈페', '인디',
  ];
  if (festivalKeywords.some(keyword => combined.includes(keyword))) {
    return '축제';
  }

  // 행사 키워드 (기본값)
  const eventKeywords = [
    '행사', '이벤트', '강연', '세미나', '워크숍',
    '마켓', '플리마켓', '바자회', '기념식', '가족',
  ];
  if (eventKeywords.some(keyword => combined.includes(keyword))) {
    return '행사';
  }

  // 기본값: 제목 길이나 구조로 추가 추론
  if (combined.includes('전') && (combined.includes('시') || combined.includes('관'))) {
    return '전시';
  }
  if (combined.includes('음악') || combined.includes('노래') || combined.includes('연주')) {
    return '공연';
  }

  // 최종 기본값
  return '행사';
}

/**
 * 메인 카테고리와 타이틀 기반으로 서브 카테고리 추론
 */
function inferSubCategory(mainCategory: MainCategory, title: string, currentSubCategory: string | null): string {
  const titleLower = (title || '').toLowerCase();
  const currentSubLower = (currentSubCategory || '').toLowerCase();
  const combined = titleLower + ' ' + currentSubLower;

  // 공연 서브 카테고리
  if (mainCategory === '공연') {
    if (/뮤지컬/.test(combined)) return '뮤지컬';
    if (/연극/.test(combined)) return '연극';
    if (/콘서트|음악회|리사이틀/.test(combined)) return '콘서트';
    if (/클래식|오케스트라|심포니|협주곡/.test(combined)) return '클래식';
    if (/무용|발레/.test(combined)) return '무용';
    if (/국악|판소리|가야금/.test(combined)) return '국악';
    return '기타 공연';
  }

  // 전시 서브 카테고리
  if (mainCategory === '전시') {
    if (/미술|그림|회화|조각/.test(combined)) return '미술 전시';
    if (/사진/.test(combined)) return '사진 전시';
    if (/미디어아트|디지털|인터랙티브/.test(combined)) return '미디어아트';
    if (/체험|참여/.test(combined)) return '체험형 전시';
    if (/어린이|키즈/.test(combined)) return '어린이 전시';
    return '특별전';
  }

  // 축제 서브 카테고리
  if (mainCategory === '축제') {
    if (/음악|재즈|인디|록|힙합/.test(combined)) return '음악 축제';
    if (/불꽃|드론|빛/.test(combined)) return '불꽃 / 드론 / 빛 축제';
    if (/벚꽃|단풍|눈|계절/.test(combined)) return '계절 축제';
    if (/전통|문화|한복|민속/.test(combined)) return '전통 / 문화 축제';
    return '지역 축제';
  }

  // 행사 서브 카테고리
  if (mainCategory === '행사') {
    if (/강연|세미나|강좌|교육/.test(combined)) return '교육 / 강연';
    if (/마켓|플리마켓|바자/.test(combined)) return '마켓 / 플리마켓';
    if (/기념|축하|개막|폐막/.test(combined)) return '기념 행사';
    if (/가족|어린이|키즈/.test(combined)) return '가족 / 어린이';
    if (/체험|참여|워크숍/.test(combined)) return '체험 행사';
    return '문화 행사';
  }

  // 팝업 서브 카테고리
  if (mainCategory === '팝업') {
    if (/카페|커피|음식|맛집|fnb|f&b|디저트|베이커리/.test(combined)) return 'F&B 팝업';
    if (/전시|갤러리|아트|작가/.test(combined)) return '전시형 팝업';
    if (/체험|워크숍|만들기|클래스/.test(combined)) return '체험형 팝업';
    if (/브랜드|콜라보|협업|한정판|스토어/.test(combined)) return '브랜드 팝업';
    return '기타 팝업';
  }

  // 기본값
  return DEFAULT_SUB_CATEGORIES[mainCategory];
}

/**
 * 카테고리 검증 및 교정
 * - main_category가 허용 리스트에 없으면 '행사'로 강제
 * - sub_category가 허용 리스트에 없거나 NULL/빈값이면 폴백으로 강제
 */
function validateAndCorrectCategories(
  mainCategory: string | null,
  subCategory: string | null,
): { validMainCategory: MainCategory; validSubCategory: string } {
  // 1. main_category 검증
  let validMainCategory: MainCategory;
  if (mainCategory && MAIN_CATEGORIES.includes(mainCategory as MainCategory)) {
    validMainCategory = mainCategory as MainCategory;
  } else {
    console.warn(`[NormalizeCategories] Invalid main_category: ${mainCategory}, forcing to '행사'`);
    validMainCategory = '행사';
  }

  // 2. sub_category 검증
  let validSubCategory: string;
  const allowedSubCategories = SUB_CATEGORIES[validMainCategory];

  if (subCategory && subCategory.trim() && allowedSubCategories.includes(subCategory)) {
    validSubCategory = subCategory;
  } else {
    if (subCategory && !allowedSubCategories.includes(subCategory)) {
      console.warn(
        `[NormalizeCategories] Invalid sub_category for ${validMainCategory}: ${subCategory}, ` +
        `forcing to '${DEFAULT_SUB_CATEGORIES[validMainCategory]}'`,
      );
    }
    validSubCategory = DEFAULT_SUB_CATEGORIES[validMainCategory];
  }

  return { validMainCategory, validSubCategory };
}

/**
 * 카테고리 정규화 메인 로직
 */
async function normalizeCategories() {
  console.log('[NormalizeCategories] Starting category normalization...');

  // 1. Delta: 정규화가 필요한 이벤트만 조회
  //    - main_category null / 허용 목록 외
  //    - sub_category null / 빈값
  //    - 최근 25시간 이내 수집/갱신 이벤트
  console.log('[NormalizeCategories] Fetching delta events (null/invalid categories + recent 25h)...');
  const events = await getCanonicalEventsForNormalizationDelta();

  console.log(`[NormalizeCategories] Delta: ${events.length} events to process`);

  let updatedCount = 0;
  let unchangedCount = 0;

  for (const event of events) {
    try {
      // 2. 수동 생성 이벤트는 카테고리를 건드리지 않음
      if (event.source_priority_winner === 'manual') {
        unchangedCount++;
        continue;
      }

      // 3. 카테고리 결정: 수집 단계에서 설정된 값을 신뢰
      //    - 이미 유효한 main_category가 있으면 그대로 유지
      //    - null이거나 허용 리스트 밖의 값일 때만 제목 기반으로 추론
      //    (각 collector의 API 코드 매핑이 제목 키워드 추론보다 정확함)
      const hasValidCategory = event.main_category &&
        MAIN_CATEGORIES.includes(event.main_category as MainCategory);

      const inferredMainCategory: MainCategory = hasValidCategory
        ? (event.main_category as MainCategory)
        : inferMainCategory(event.title, event.sub_category);

      // 4. 서브 카테고리 추론 (유효하지 않은 경우만)
      const hasValidSubCategory = event.sub_category &&
        SUB_CATEGORIES[inferredMainCategory]?.includes(event.sub_category);

      const inferredSubCategory = hasValidSubCategory
        ? event.sub_category!
        : inferSubCategory(inferredMainCategory, event.title, event.sub_category);

      // 4. 최종 검증 및 교정 (완전성 보장)
      const { validMainCategory, validSubCategory } = validateAndCorrectCategories(
        inferredMainCategory,
        inferredSubCategory,
      );

      // 5. source_priority_winner 보정
      const correctSourcePriorityWinner = SOURCE_PRIORITY[validMainCategory];

      // 6. 변경 여부 확인
      const needsUpdate =
        event.main_category !== validMainCategory ||
        event.sub_category !== validSubCategory ||
        event.source_priority_winner !== correctSourcePriorityWinner;

      if (needsUpdate) {
        // 7. 업데이트
        await updateCanonicalEventCategories(
          event.id,
          validMainCategory,
          validSubCategory,
          correctSourcePriorityWinner,
        );

        updatedCount++;

        if (updatedCount % 10 === 0) {
          console.log(`[NormalizeCategories] Processed ${updatedCount} updates...`);
        }

        // 디버그: 변경 내용 로그 (처음 10개만)
        if (updatedCount <= 10) {
          console.log(`[NormalizeCategories] Updated: ${event.title.slice(0, 30)}`);
          console.log(`  Main: ${event.main_category} → ${validMainCategory}`);
          console.log(`  Sub: ${event.sub_category} → ${validSubCategory}`);
          console.log(`  Winner: ${event.source_priority_winner} → ${correctSourcePriorityWinner}`);
        }
      } else {
        unchangedCount++;
      }
    } catch (error) {
      console.error(`[NormalizeCategories] Error processing event: ${event.title}`, error);
    }
  }

  console.log('[NormalizeCategories] Category normalization complete!');
  console.log(`  - Total events: ${events.length}`);
  console.log(`  - Updated: ${updatedCount}`);
  console.log(`  - Unchanged: ${unchangedCount}`);

  // 7. 카테고리 완전성 검증
  console.log('\n[NormalizeCategories] Verifying category coverage...');

  const { pool } = await import('../db');

  // 7-1. main_category별 total 조회
  const totalByMainResult = await pool.query(`
    SELECT main_category, COUNT(*) as total
    FROM canonical_events
    GROUP BY main_category
    ORDER BY main_category;
  `);

  // 7-2. main_category별 sub_category별 count 조회
  const countBySubResult = await pool.query(`
    SELECT main_category, sub_category, COUNT(*) as count
    FROM canonical_events
    GROUP BY main_category, sub_category
    ORDER BY main_category, count DESC;
  `);

  // 7-3. main_category별 sub_sum 계산 및 diff 검증
  const totalByMain = new Map<string, number>();
  for (const row of totalByMainResult.rows) {
    totalByMain.set(row.main_category, parseInt(row.total, 10));
  }

  const subSumByMain = new Map<string, number>();
  for (const row of countBySubResult.rows) {
    const current = subSumByMain.get(row.main_category) || 0;
    subSumByMain.set(row.main_category, current + parseInt(row.count, 10));
  }

  console.log('\n[NormalizeCategories] Coverage verification:');
  for (const mainCategory of MAIN_CATEGORIES) {
    const total = totalByMain.get(mainCategory) || 0;
    const subSum = subSumByMain.get(mainCategory) || 0;
    const diff = total - subSum;

    console.log(`  ${mainCategory}: total=${total}, sub_sum=${subSum}, diff=${diff}`);

    if (diff !== 0) {
      console.warn(`  ⚠️  WARNING: ${mainCategory} has coverage gap! diff=${diff}`);
    }
  }

  // 7-4. 서브 카테고리 분포 출력
  console.log('\n[NormalizeCategories] Sub-category distribution:');
  for (const row of countBySubResult.rows) {
    console.log(`  ${row.main_category} > ${row.sub_category}: ${row.count}`);
  }

  // 7-5. 결과 통계
  console.log('\n[NormalizeCategories] Verification SQL commands:');
  console.log('  Run these to verify:');
  console.log(`  (1) SELECT main_category, sub_category, COUNT(*) FROM canonical_events WHERE sub_category IS NULL OR sub_category = '' GROUP BY main_category, sub_category;`);
  console.log(`  (2) SELECT main_category, COUNT(*) as total FROM canonical_events GROUP BY main_category ORDER BY main_category;`);
}

// CLI 직접 실행 시에만 동작 (동적 import 시 process.exit 방지)
if (require.main === module) {
  normalizeCategories()
    .then(() => {
      console.log('[NormalizeCategories] Job finished successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[NormalizeCategories] Fatal error:', err);
      process.exit(1);
    });
}
