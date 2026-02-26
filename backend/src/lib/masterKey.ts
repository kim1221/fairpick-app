/**
 * masterKey 계산 유틸리티
 *
 * 같은 이벤트의 변형들(지역만 다르거나 회차만 다름)을 식별하기 위한 마스터 키 생성.
 * MASTER 필드(overview, derived_tags, 핵심 콘텐츠 등)는 masterKey 기준으로 캐시/공유됨.
 */

import crypto from 'crypto';

export interface MasterKeyInput {
  title: string;
  main_category: string;
  start_at?: string | null; // ISO date string or null
  end_at?: string | null;
}

/**
 * 제목을 정규화 (normalize)
 *
 * - 소문자 변환
 * - 공백/특수문자 제거 (한글, 영문, 숫자만 남김)
 * - 지역 태그 제거 (예: "[서울 강남]", "(부산)", "- 대전")
 *
 * 예: "백설공주 [서울 구로]" → "백설공주"
 * 예: "Van Gogh Exhibition - Seoul" → "vangoghexhibition"
 */
export function normalizeTitle(title: string): string {
  let normalized = title.toLowerCase().trim();

  // 대괄호 태그 제거: [서울 강남], [부산] 등
  normalized = normalized.replace(/\[.*?\]/g, '');

  // 괄호 태그 제거: (서울), (강남점) 등
  normalized = normalized.replace(/\(.*?\)/g, '');

  // 하이픈 뒤 지역명 제거: "- 서울", "- 부산" 등
  normalized = normalized.replace(/\s*-\s*[가-힣]+\s*$/g, '');

  // 공백 정규화 (여러 공백 → 한 칸)
  normalized = normalized.replace(/\s+/g, ' ');

  // 특수문자 제거 (한글, 영문, 숫자, 공백만 남김)
  normalized = normalized.replace(/[^a-z0-9가-힣\s]/g, '');

  // 양쪽 공백 제거
  normalized = normalized.trim();

  return normalized;
}

/**
 * 날짜 범위를 "분기(quarter)" 단위로 정규화
 *
 * 같은 이벤트가 지역별로 날짜가 약간 다를 수 있으므로 (예: 1일 차이),
 * 분기 단위로 뭉개서 동일한 이벤트로 인식하게 함.
 *
 * 예:
 * - 2026-03-01 ~ 2026-03-28 → "2026-Q1"
 * - 2026-03-03 ~ 2026-03-29 → "2026-Q1" (동일)
 * - 2026-06-01 ~ 2026-08-31 → "2026-Q2~Q3"
 *
 * @returns "YYYY-QN" or "YYYY-QN~QM" or null (날짜 없으면)
 */
export function normalizeDateRange(
  startAt: string | null | undefined,
  endAt: string | null | undefined
): string | null {
  if (!startAt && !endAt) return null;

  const getQuarter = (dateStr: string): { year: number; quarter: number } | null => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    const quarter = Math.ceil(month / 3); // 1,2,3,4

    return { year, quarter };
  };

  const start = startAt ? getQuarter(startAt) : null;
  const end = endAt ? getQuarter(endAt) : null;

  if (!start && !end) return null;

  // 시작일만 있는 경우
  if (start && !end) {
    return `${start.year}-Q${start.quarter}`;
  }

  // 종료일만 있는 경우
  if (!start && end) {
    return `${end.year}-Q${end.quarter}`;
  }

  // 둘 다 있는 경우
  if (start && end) {
    if (start.year === end.year && start.quarter === end.quarter) {
      // 같은 분기
      return `${start.year}-Q${start.quarter}`;
    } else {
      // 다른 분기
      return `${start.year}-Q${start.quarter}~${end.year}-Q${end.quarter}`;
    }
  }

  return null;
}

/**
 * 이벤트의 masterKey 계산
 *
 * Formula: SHA256(normalizedTitle + category + dateRange)
 *
 * 같은 전시/공연/팝업이 지역만 다르게 여러 개 등록되어도
 * 동일한 masterKey를 가지므로 MASTER 필드를 공유할 수 있음.
 *
 * 예:
 * - "백설공주 [서울 구로]", 공연, 2026-03-07~2026-03-29
 * - "백설공주 [부산]", 공연, 2026-03-10~2026-03-28
 * → 둘 다 masterKey: "hash(백설공주+공연+2026-Q1)"
 *
 * @param input - 이벤트 기본 정보 (title, category, dates)
 * @returns masterKey (hex string, 16자리)
 */
export function calculateMasterKey(input: MasterKeyInput): string {
  const { title, main_category, start_at, end_at } = input;

  const normalizedTitle = normalizeTitle(title);
  const dateRange = normalizeDateRange(start_at, end_at);

  // 결합 문자열: "제목|카테고리|날짜범위"
  const combined = [normalizedTitle, main_category.toLowerCase(), dateRange || 'nodate'].join('|');

  // SHA256 해시 → 16자리 hex (충돌 방지)
  const hash = crypto.createHash('sha256').update(combined, 'utf8').digest('hex');

  // 처음 16자리만 사용 (가독성 + 충돌 확률 충분히 낮음)
  return hash.substring(0, 16);
}

/**
 * DEV 전용: masterKey 계산 과정 로깅
 */
export function calculateMasterKeyWithLogging(
  input: MasterKeyInput,
  isDev: boolean = false
): string {
  const { title, main_category, start_at, end_at } = input;

  const normalizedTitle = normalizeTitle(title);
  const dateRange = normalizeDateRange(start_at, end_at);
  const masterKey = calculateMasterKey(input);

  if (isDev) {
    console.log(`[MASTERKEY][CALC] title="${title}" → normalized="${normalizedTitle}"`);
    console.log(`[MASTERKEY][CALC] category="${main_category}" dateRange="${dateRange}"`);
    console.log(`[MASTERKEY][CALC] masterKey="${masterKey}"`);
  }

  return masterKey;
}
