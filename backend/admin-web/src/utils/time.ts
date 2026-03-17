/**
 * UTC-naive 문자열(timezone suffix 없는 DB TIMESTAMP) 전용 시간 유틸
 *
 * DB 저장 규칙:
 *   - pg 세션에 SET timezone = 'UTC' 적용
 *   - types.setTypeParser(1114, raw string)로 suffix 없이 반환
 *   - 예: "2026-03-16 18:00:01"  ← 실제 UTC 시간, 9h 더하면 KST
 *
 * 주의: new Date("2026-03-16 18:00:01") 은 브라우저 로컬(KST)로 파싱돼
 *       UTC 09:00:01로 해석됨 → 9시간 오차 발생.
 *       반드시 이 파일의 함수를 경유할 것.
 */

/** UTC-naive string → "T" + "Z" 붙여 UTC Date 반환 */
export function parseUtc(isoStr: string): Date {
  const normalized = isoStr.replace(' ', 'T');
  const utcIso = /[Z+]/.test(normalized.slice(-6)) ? normalized : normalized + 'Z';
  return new Date(utcIso);
}

/** UTC-naive string → UTC milliseconds */
export function toUtcMs(isoStr: string): number {
  return parseUtc(isoStr).getTime();
}

/**
 * UTC-naive string → KST 상대시간 문자열
 * 예: "3분 전", "2시간 전", "1일 전"
 */
export function fmtRelative(isoStr: string | null): string {
  if (!isoStr) return '—';
  const diffMs = Date.now() - toUtcMs(isoStr);
  if (diffMs < 0) return '방금';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}일 전`;
  if (h > 0) return `${h}시간 ${m}분 전`;
  return `${m}분 전`;
}

/**
 * UTC-naive string → KST 절대시간 문자열
 * 예: "03. 17. 오전 03:00:01"
 */
export function fmtDateTime(
  isoStr: string | null,
  opts: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  },
): string {
  if (!isoStr) return '—';
  const d = parseUtc(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', ...opts });
}
