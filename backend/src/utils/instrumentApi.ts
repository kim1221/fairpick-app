/**
 * API 성능/트래픽 계측 유틸리티
 * 
 * 기능 변경 없이 로그 계측만 수행
 * 고정 로그 포맷: [INSTRUMENT][API] ts=<ISO> endpoint="<METHOD PATH>" status=<code> elapsed=<ms> query=<json> count=<n|null> payloadKB=<kb>
 */

/**
 * 현재 시각을 ISO8601 문자열로 반환
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 바이트를 KB로 변환 (소수점 1자리 반올림)
 */
export function bytesToKB(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

/**
 * 객체를 JSON.stringify하여 크기를 KB로 반환
 * 순환 참조 등으로 실패 시 -1 반환
 */
export function safeJsonSizeKB(obj: unknown): number {
  try {
    const jsonStr = JSON.stringify(obj);
    const bytes = Buffer.byteLength(jsonStr, 'utf8');
    return bytesToKB(bytes);
  } catch (error) {
    // 순환 참조 또는 stringify 실패
    return -1;
  }
}

/**
 * API 계측 로그 출력
 */
export interface ApiMetricsParams {
  endpoint: string; // 예: "GET /events"
  ts: string; // ISO8601
  query: Record<string, unknown>; // req.query
  status: number; // HTTP status code
  count: number | null; // 아이템 개수 (배열 length, 단건 1, 알 수 없으면 null)
  payloadKB: number; // 응답 payload 크기 (-1 가능)
  elapsedMs: number; // 소요 시간 (ms)
}

export function logApiMetrics(params: ApiMetricsParams): void {
  const { endpoint, ts, query, status, count, payloadKB, elapsedMs } = params;
  
  // query를 JSON으로 변환 (실패 시 빈 객체)
  let queryJson = '{}';
  try {
    queryJson = JSON.stringify(query);
  } catch {
    queryJson = '{}';
  }
  
  // 고정 로그 포맷 (1줄)
  console.log(
    `[INSTRUMENT][API] ts=${ts} endpoint="${endpoint}" status=${status} elapsed=${elapsedMs} query=${queryJson} count=${count === null ? 'null' : count} payloadKB=${payloadKB}`
  );
}

/**
 * API 핸들러용 헬퍼: 시작 시각 측정
 */
export function startTimer(): number {
  return Date.now();
}

/**
 * API 핸들러용 헬퍼: 경과 시간 계산 (ms)
 */
export function getElapsedMs(startTime: number): number {
  return Date.now() - startTime;
}


