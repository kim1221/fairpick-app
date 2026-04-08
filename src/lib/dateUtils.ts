/**
 * 날짜 포맷 유틸리티
 *
 * 다양한 날짜 포맷을 안전하게 파싱하고 표시합니다.
 * "Invalid Date" 노출을 방지하고, KST 기준으로 처리합니다.
 */

/**
 * 날짜 문자열 또는 timestamp를 Date 객체로 안전하게 파싱
 *
 * 지원 포맷:
 * - ISO 8601: "2025-01-15T00:00:00Z", "2025-01-15T00:00:00+09:00"
 * - 하이픈: "2025-01-15"
 * - 점: "2025.01.15"
 * - 슬래시: "2025/01/15"
 * - timestamp: 숫자 (밀리초)
 *
 * @param dateInput - 날짜 문자열 또는 timestamp
 * @returns Date 객체 또는 null (파싱 실패 시)
 */
export function parseDate(dateInput: string | number | null | undefined): Date | null {
  // null/undefined/빈 문자열 체크
  if (dateInput === null || dateInput === undefined || dateInput === '') {
    return null;
  }

  // timestamp (숫자) 처리
  if (typeof dateInput === 'number') {
    const date = new Date(dateInput);
    return isValidDate(date) ? date : null;
  }

  const trimmed = dateInput.trim();

  // ISO 8601 형식 체크 (T가 포함되어 있으면 ISO 형식으로 간주)
  // 예: "2026-06-13T15:00:00.000Z", "2025-01-15T00:00:00+09:00"
  if (trimmed.includes('T')) {
    const date = new Date(trimmed);
    return isValidDate(date) ? date : null;
  }

  // 간단한 날짜 형식 정규화 (YYYY.MM.DD, YYYY/MM/DD → YYYY-MM-DD)
  let normalized = trimmed;
  normalized = normalized.replace(/\./g, '-');  // "2025.01.15" → "2025-01-15"
  normalized = normalized.replace(/\//g, '-');  // "2025/01/15" → "2025-01-15"

  // Date 객체 생성
  const date = new Date(normalized);

  // 유효성 검사
  return isValidDate(date) ? date : null;
}

/**
 * Date 객체가 유효한지 검사
 */
function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * Date 객체를 "YYYY.MM.DD" 형식으로 포맷
 * KST(Asia/Seoul) 기준으로 처리하여 날짜가 밀리지 않도록 함
 *
 * @param date - Date 객체
 * @returns "YYYY.MM.DD" 형식 문자열
 */
export function formatDate(date: Date): string {
  // KST 기준으로 날짜 추출 (UTC 파싱으로 인한 -1day 방지)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}.${month}.${day}`;
}

/**
 * Date 객체를 간단한 형식으로 포맷 (월.일)
 *
 * @param date - Date 객체
 * @returns "M.D" 형식 문자열 (예: "1.15", "12.5")
 */
export function formatShortDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return `${month}.${day}`;
}

/**
 * 이벤트 기간 포맷 (시작일 ~ 종료일)
 *
 * @param startAt - 시작일 (ISO 8601 또는 "YYYY-MM-DD" 등)
 * @param endAt - 종료일 (ISO 8601 또는 "YYYY-MM-DD" 등)
 * @returns 포맷된 기간 문자열
 *
 * 예시:
 * - 시작/종료 모두 있음: "2025.01.15 ~ 2025.02.28"
 * - 시작만 있음: "2025.01.15 ~"
 * - 종료만 있음: "~ 2025.02.28"
 * - 둘 다 없음: "일정 미정"
 */
export function formatEventPeriod(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
): string {
  const startDate = parseDate(startAt);
  const endDate = parseDate(endAt);

  if (startDate && endDate) {
    return `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
  }

  if (startDate) {
    return `${formatDate(startDate)} ~`;
  }

  if (endDate) {
    return `~ ${formatDate(endDate)}`;
  }

  return '일정 미정';
}

/**
 * 이벤트 기간 포맷 (간단한 형식: M.D ~ M.D)
 *
 * @param startAt - 시작일
 * @param endAt - 종료일
 * @returns 포맷된 기간 문자열 (간단한 형식)
 *
 * 예시:
 * - "1.15 ~ 2.28"
 * - "12.1 ~ 12.31"
 */
export function formatEventPeriodShort(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
): string {
  const startDate = parseDate(startAt);
  const endDate = parseDate(endAt);

  if (startDate && endDate) {
    return `${formatShortDate(startDate)} ~ ${formatShortDate(endDate)}`;
  }

  if (startDate) {
    return `${formatShortDate(startDate)} ~`;
  }

  if (endDate) {
    return `~ ${formatShortDate(endDate)}`;
  }

  return '일정 미정';
}

/**
 * 종료일(마감일) 포맷
 *
 * @param endAt - 종료일
 * @returns 포맷된 마감일 문자열
 *
 * 예시:
 * - "마감: 2025.02.28"
 * - "마감일 미정" (날짜 없음)
 */
export function formatEndDate(endAt: string | null | undefined): string {
  const endDate = parseDate(endAt);

  if (endDate) {
    return `마감: ${formatDate(endDate)}`;
  }

  return '마감일 미정';
}

/**
 * 날짜 긴박도 레벨
 *
 * - critical : D-3 이하 / 오늘마감 / 내일마감 → 빨간색 + 굵게
 * - soon     : D-4 ~ D-7 / 이번주말 마감       → 주황색
 * - normal   : 진행 중, 기간 넉넉              → 기본 회색
 * - upcoming : 아직 시작 전 / 이미 종료        → 연한 회색
 */
export type DateUrgency = 'critical' | 'soon' | 'normal' | 'upcoming';

export function getDateUrgency(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
): DateUrgency {
  const startDate = parseDate(startAt);
  const endDate   = parseDate(endAt);

  if (!startDate && !endDate) return 'normal';

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayMs = todayMidnight.getTime();

  const toMidnightMs = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const daysLeft    = endDate   !== null ? Math.round((toMidnightMs(endDate)   - todayMs) / 86_400_000) : null;
  const daysToStart = startDate !== null ? Math.round((toMidnightMs(startDate) - todayMs) / 86_400_000) : null;

  // 아직 시작 전
  if (daysToStart !== null && daysToStart > 0) return 'upcoming';

  // 이미 종료
  if (daysLeft !== null && daysLeft < 0) return 'upcoming';

  // D-3 이내 (오늘·내일 마감 포함)
  if (daysLeft !== null && daysLeft <= 3) return 'critical';

  // D-7 이내 (이번 주말 마감 포함)
  if (daysLeft !== null && daysLeft <= 7) return 'soon';

  return 'normal';
}

/**
 * 이벤트 기간을 사용자 친화적 표현으로 포맷
 *
 * 우선순위 (오늘 기준):
 * - 오늘 마감 → "오늘 마감"
 * - 내일 마감 → "내일 마감"
 * - 3일 이내 → "D-N"
 * - 토/일 마감 (7일 이내) → "이번 주말 마감"
 * - 7일 이내 → "D-N"
 * - 단일 날짜 (오늘) → "오늘만!"
 * - 단일 날짜 (내일) → "내일 하루"
 * - 단일 날짜 (미래) → "M.D 하루"
 * - 진행 중, 기간 있음 → "~M.D"
 * - 시작 전 → "M.D 시작"
 * - 종료됨 → "M.D 종료"
 * - 날짜 없음 → "일정 미정"
 *
 * @param startAt - 시작일 문자열 (ISO 8601 등)
 * @param endAt - 종료일 문자열 (ISO 8601 등)
 */
export function formatEventPeriodHuman(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
): string {
  const startDate = parseDate(startAt);
  const endDate = parseDate(endAt);

  if (!startDate && !endDate) return '일정 미정';

  // 오늘 자정 (로컬 타임존 — 한국 사용자는 KST)
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayMs = todayMidnight.getTime();

  // Date를 자정(00:00:00)으로 정규화해 ms 반환
  const toMidnightMs = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  // 종료일 기준 남은 일수 (음수 = 이미 종료)
  const daysLeft = endDate !== null
    ? Math.round((toMidnightMs(endDate) - todayMs) / 86_400_000)
    : null;

  // 시작일 기준 남은 일수 (음수 = 이미 시작)
  const daysToStart = startDate !== null
    ? Math.round((toMidnightMs(startDate) - todayMs) / 86_400_000)
    : null;

  // ── 종료일만 있는 경우 ──────────────────────────────
  if (!startDate && endDate) {
    if (daysLeft! < 0)   return `${formatShortDate(endDate)} 종료`;
    if (daysLeft === 0)  return '오늘 마감';
    if (daysLeft === 1)  return '내일 마감';
    if (daysLeft! <= 7) {
      const dow = endDate.getDay(); // 0=일, 6=토
      if (dow === 0 || dow === 6) return '이번 주말 마감';
      return `D-${daysLeft}`;
    }
    return `~${formatShortDate(endDate)}`;
  }

  // ── 시작일만 있는 경우 ──────────────────────────────
  if (startDate && !endDate) {
    if (daysToStart! > 0) return `${formatShortDate(startDate)} 시작`;
    return `${formatShortDate(startDate)}~`; // 시작했지만 종료일 미정
  }

  // ── 시작/종료 모두 있는 경우 ────────────────────────
  const isSingleDay =
    toMidnightMs(startDate!) === toMidnightMs(endDate!);

  // 단일 날짜 이벤트
  if (isSingleDay) {
    if (daysLeft! < 0)  return `${formatShortDate(endDate!)} 종료`;
    if (daysLeft === 0) return '오늘만!';
    if (daysLeft === 1) return '내일 하루';
    return `${formatShortDate(startDate!)} 하루`;
  }

  // 이미 종료
  if (daysLeft! < 0) return `${formatShortDate(endDate!)} 종료`;

  // 아직 시작 전
  if (daysToStart! > 0) {
    if (daysToStart === 1) return '내일 시작';
    return `${formatShortDate(startDate!)} 시작`;
  }

  // 진행 중
  if (daysLeft === 0) return '오늘 마감';
  if (daysLeft === 1) return '내일 마감';
  if (daysLeft! <= 3) return `D-${daysLeft}`;
  if (daysLeft! <= 7) {
    const dow = endDate!.getDay(); // 0=일, 6=토
    if (dow === 0 || dow === 6) return '이번 주말 마감';
    return `D-${daysLeft}`;
  }

  return `~${formatShortDate(endDate!)}`;
}
